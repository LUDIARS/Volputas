// Ability-estimation engine (ludellus-tuning-log-design.md §8).
// Reads a user's windowed ludellus.trial_result / calibration_result events and
// derives a player_ability_snapshots row: reaction distribution, reading speed,
// vocab level, accuracy curves, timeout rate, consistency and 7-day trend.
//
// All metric math lives in pure, injectable-DB functions (mirrors
// affectTimeline.js / tuningParams.js) so it is unit-testable without a database.
// Every value is recomputable from raw play_events (design principle #4): the
// snapshot table is a rebuildable summary, never a source of truth.
//
// Design choices made where §8 leaves a threshold unspecified (see PR notes):
//  - low-language-load = item text_len <= 6 chars OR vocab_level <= 1
//  - RTT exclusion threshold = 200ms; RTT/2 subtracted from timings otherwise
//  - freshness decay = exp with 30-day half-life, applied via weighted aggregates
//  - trend_7d base metric = vocab_level_estimate (positive = improvement)
//  - default aggregation window = 30 days

const db = require('../config/database');
const {
  TRIAL_RESULT_EVENT_TYPE,
  CALIBRATION_EVENT_TYPE,
  isTrialResultType,
  isCalibrationType,
  extractTrial,
} = require('./trialResult');

const ALGO_VERSION = 1;
const ALL_GAMES = '_all';

const DEFAULT_WINDOW_DAYS = 30;
const FRESHNESS_HALF_LIFE_DAYS = 30;       // §8.2 鮮度重み
const MIN_HUMAN_FIRST_INPUT_MS = 150;      // §8.2 outlier floor
const RTT_EXCLUDE_MS = 200;                // §8.2 RTT gate (chosen default)
const LOW_LOAD_TEXT_LEN = 6;               // low-language-load cutoff (chosen)
const LOW_LOAD_VOCAB_LEVEL = 1;            // low-language-load cutoff (chosen)
const LOW_SAMPLE_THRESHOLD = 30;           // §8.2 minimum sample
const MIN_LEVEL_SAMPLES = 1;               // per-level attempts to include in curve
const VOCAB_ACCURACY_TARGET = 0.70;        // §3.2 / §8.1 accuracy threshold
const DAY_MS = 86_400_000;

// Event types this engine consumes (namespaced + legacy bare names).
const CONSUMED_EVENT_TYPES = [
  TRIAL_RESULT_EVENT_TYPE, 'trial_result',
  CALIBRATION_EVENT_TYPE, 'calibration_result',
];

// ---------------------------------------------------------------------------
// Numeric helpers (pure)
// ---------------------------------------------------------------------------

function round(n, dp) {
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function validPairs(pairs) {
  return pairs.filter((x) => Number.isFinite(x.value) && Number.isFinite(x.weight) && x.weight > 0);
}

// Weighted percentile using cumulative-weight crossing (p in [0,1]).
function weightedPercentile(pairs, p) {
  const valid = validPairs(pairs);
  if (valid.length === 0) return null;
  const sorted = [...valid].sort((a, b) => a.value - b.value);
  const total = sorted.reduce((s, x) => s + x.weight, 0);
  const target = p * total;
  let cum = 0;
  for (const x of sorted) {
    cum += x.weight;
    if (cum >= target) return x.value;
  }
  return sorted[sorted.length - 1].value;
}

function dropUpperOutliers(pairs, p) {
  if (pairs.length < 3) return pairs;
  const cutoff = weightedPercentile(pairs, p);
  if (cutoff === null) return pairs;
  return pairs.filter((x) => x.value <= cutoff);
}

function weightedMean(pairs) {
  const valid = validPairs(pairs);
  if (valid.length === 0) return null;
  const wsum = valid.reduce((s, x) => s + x.weight, 0);
  return valid.reduce((s, x) => s + x.value * x.weight, 0) / wsum;
}

function weightedTrimmedMean(pairs, trim) {
  const valid = validPairs(pairs);
  if (valid.length === 0) return null;
  if (valid.length < 5) return weightedMean(valid);
  const sorted = [...valid].sort((a, b) => a.value - b.value);
  const cut = Math.floor(sorted.length * trim);
  const kept = sorted.slice(cut, sorted.length - cut);
  return weightedMean(kept.length ? kept : sorted);
}

function weightedProportion(items, predicate) {
  const valid = items.filter((t) => Number.isFinite(t.weight) && t.weight > 0);
  if (valid.length === 0) return null;
  const wsum = valid.reduce((s, t) => s + t.weight, 0);
  const hit = valid.reduce((s, t) => s + (predicate(t) ? t.weight : 0), 0);
  return hit / wsum;
}

function weightedCoefficientOfVariation(pairs) {
  const valid = validPairs(pairs);
  if (valid.length < 2) return null;
  const m = weightedMean(valid);
  if (m === null || m === 0) return null;
  const wsum = valid.reduce((s, x) => s + x.weight, 0);
  const variance = valid.reduce((s, x) => s + x.weight * (x.value - m) ** 2, 0) / wsum;
  return Math.sqrt(variance) / m;
}

// §8.2 freshness weight: exponential decay with a 30-day half-life.
function computeFreshnessWeight(occurredAtMs, nowMs, halfLifeDays = FRESHNESS_HALF_LIFE_DAYS) {
  if (!Number.isFinite(occurredAtMs) || !Number.isFinite(nowMs)) return 1;
  const ageDays = (nowMs - occurredAtMs) / DAY_MS;
  if (ageDays <= 0) return 1;
  return Math.pow(0.5, ageDays / halfLifeDays);
}

// ---------------------------------------------------------------------------
// Trial enrichment + grouped accuracy (pure)
// ---------------------------------------------------------------------------

// Apply §8.2 rules: RTT/2 correction, pause exclusion, human-floor exclusion,
// RTT-gate exclusion, low-language-load tagging and freshness weight.
function enrichTrial(trial, motorBaselineMs, nowMs, halfLifeDays) {
  const weight = computeFreshnessWeight(trial.occurredAtMs, nowMs, halfLifeDays);
  const rttHalf = trial.rttMs !== null && trial.rttMs !== undefined ? trial.rttMs / 2 : 0;
  const correctedFirstInputMs = trial.firstInputMs !== null && trial.firstInputMs !== undefined
    ? Math.max(0, trial.firstInputMs - rttHalf) : null;
  const correctedResponseMs = trial.responseMs !== null && trial.responseMs !== undefined
    ? Math.max(0, trial.responseMs - rttHalf) : null;
  const lowLoad = (trial.textLen !== null && trial.textLen <= LOW_LOAD_TEXT_LEN)
    || (trial.vocabLevel !== null && trial.vocabLevel <= LOW_LOAD_VOCAB_LEVEL);
  const speedEligible = (trial.pausedMs || 0) === 0
    && !(trial.firstInputMs !== null && trial.firstInputMs < MIN_HUMAN_FIRST_INPUT_MS)
    && !(trial.rttMs !== null && trial.rttMs > RTT_EXCLUDE_MS);
  return { ...trial, weight, correctedFirstInputMs, correctedResponseMs, lowLoad, speedEligible };
}

function groupAccuracyDetailed(attempts, keyFn) {
  const map = new Map();
  for (const t of attempts) {
    const key = keyFn(t);
    if (key === null || key === undefined) continue;
    const w = Number.isFinite(t.weight) && t.weight > 0 ? t.weight : 0;
    if (w === 0) continue;
    const d = map.get(key) || { attempts: 0, weightedCorrect: 0, weightSum: 0 };
    d.attempts += 1;
    d.weightSum += w;
    if (t.correct) d.weightedCorrect += w;
    map.set(key, d);
  }
  return map;
}

function detailToAccuracy(map) {
  const out = {};
  for (const [k, d] of map.entries()) {
    if (d.weightSum > 0) out[k] = round(d.weightedCorrect / d.weightSum, 4);
  }
  return out;
}

// §8.1 vocab_level_estimate: highest level holding accuracy >= target, with
// linear interpolation at the crossing. Falls back to the top tested level (all
// above target) or below the easiest level (even the easiest is below target).
function estimateVocabLevel(levelDetail, target) {
  const points = [...levelDetail.entries()]
    .map(([k, d]) => ({
      level: Number(k),
      acc: d.weightSum ? d.weightedCorrect / d.weightSum : 0,
      attempts: d.attempts,
    }))
    .filter((p) => Number.isFinite(p.level) && p.attempts >= MIN_LEVEL_SAMPLES)
    .sort((a, b) => a.level - b.level);
  if (points.length === 0) return null;
  if (points.length === 1) {
    return points[0].acc >= target ? points[0].level : Math.max(0, points[0].level - 1);
  }
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (a.acc >= target && b.acc < target) {
      const frac = (a.acc - target) / (a.acc - b.acc);
      return a.level + frac * (b.level - a.level);
    }
  }
  if (points[0].acc < target) return Math.max(0, points[0].level - 1);
  return points[points.length - 1].level;
}

// §8.1 trend_7d: EWMA-smoothed relative change of the base metric over the
// window (positive = improvement for vocab_level_estimate). Needs >= 2 points.
function computeTrend7d(series, alpha = 0.5) {
  const values = series.filter((v) => Number.isFinite(v));
  if (values.length < 2) return null;
  let ewma = values[0];
  for (let i = 1; i < values.length; i++) ewma = alpha * values[i] + (1 - alpha) * ewma;
  const base = values[0];
  if (base === 0) return null;
  return round((ewma - base) / Math.abs(base), 4);
}

// ---------------------------------------------------------------------------
// Core metric computation (pure)
// ---------------------------------------------------------------------------

// trials: array from extractTrial(), each optionally carrying `occurredAtMs`.
// calibrationFirstInputs: flat array of calibration_result first_input_ms values.
// Returns { metrics, sampleTrials }. `trend_7d` is left null here and filled by
// the orchestrator from snapshot history.
function computeAbilityMetrics(trials, calibrationFirstInputs = [], options = {}) {
  const nowMs = options.now !== undefined && options.now !== null ? Number(options.now) : null;
  const halfLifeDays = options.freshnessHalfLifeDays ?? FRESHNESS_HALF_LIFE_DAYS;

  const calValues = calibrationFirstInputs
    .filter((v) => Number.isFinite(v) && v >= MIN_HUMAN_FIRST_INPUT_MS);
  const motorBaselineMs = calValues.length ? round(median(calValues), 1) : null;

  const enriched = trials.map((t) => enrichTrial(t, motorBaselineMs, nowMs, halfLifeDays));
  const sampleTrials = enriched.length;

  // Reaction distribution — low-language-load, speed-eligible trials.
  const reactionPairs = dropUpperOutliers(
    enriched
      .filter((t) => t.speedEligible && t.lowLoad && t.correctedFirstInputMs !== null)
      .map((t) => ({ value: t.correctedFirstInputMs, weight: t.weight })),
    0.99,
  );

  // Reading speed — (first_input − motor_baseline) / text_len, robust mean.
  let readingSpeed = null;
  if (motorBaselineMs !== null) {
    readingSpeed = weightedTrimmedMean(
      enriched
        .filter((t) => t.speedEligible && t.correctedFirstInputMs !== null && t.textLen !== null && t.textLen > 0)
        .map((t) => ({ value: (t.correctedFirstInputMs - motorBaselineMs) / t.textLen, weight: t.weight })),
      0.1,
    );
  }

  const levelDetail = groupAccuracyDetailed(enriched, (t) => (t.vocabLevel !== null ? String(t.vocabLevel) : null));
  const categoryDetail = groupAccuracyDetailed(enriched, (t) => t.category);

  const consistency = weightedCoefficientOfVariation(
    enriched
      .filter((t) => t.speedEligible && !t.isTimeout && t.correctedResponseMs !== null)
      .map((t) => ({ value: t.correctedResponseMs, weight: t.weight })),
  );

  const metrics = {
    motor_baseline_ms: motorBaselineMs,
    reaction_p50_ms: round(weightedPercentile(reactionPairs, 0.5), 1),
    reaction_p10_ms: round(weightedPercentile(reactionPairs, 0.1), 1),
    reaction_p90_ms: round(weightedPercentile(reactionPairs, 0.9), 1),
    reading_speed_ms_per_char: round(readingSpeed, 2),
    vocab_level_estimate: round(estimateVocabLevel(levelDetail, VOCAB_ACCURACY_TARGET), 2),
    accuracy_by_level: detailToAccuracy(levelDetail),
    accuracy_by_category: detailToAccuracy(categoryDetail),
    timeout_rate: round(weightedProportion(enriched, (t) => t.isTimeout), 4),
    consistency: round(consistency, 4),
    trend_7d: null,
    confidence: sampleTrials >= LOW_SAMPLE_THRESHOLD ? 'ok' : 'low',
  };
  return { metrics, sampleTrials };
}

// ---------------------------------------------------------------------------
// DB row shaping + persistence
// ---------------------------------------------------------------------------

function snapshotView(row) {
  if (!row) return null;
  return {
    id: typeof row.id === 'string' ? Number(row.id) : row.id,
    userId: row.user_id,
    gameId: row.game_id,
    deviceClass: row.device_class ?? null,
    metrics: row.metrics ?? {},
    sampleTrials: row.sample_trials,
    windowStart: row.window_start ?? null,
    windowEnd: row.window_end ?? null,
    algoVersion: row.algo_version,
    computedAt: row.computed_at,
  };
}

async function saveAbilitySnapshot(snapshot, database = db) {
  const { rows } = await database.query(
    `INSERT INTO player_ability_snapshots
       (user_id, game_id, device_class, metrics, sample_trials, window_start, window_end, algo_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      snapshot.userId,
      snapshot.gameId,
      snapshot.deviceClass ?? null,
      JSON.stringify(snapshot.metrics),
      snapshot.sampleTrials,
      snapshot.windowStart,
      snapshot.windowEnd,
      ALGO_VERSION,
    ],
  );
  return snapshotView(rows[0]);
}

async function getLatestAbilitySnapshot(userId, gameId, database = db) {
  const { rows } = await database.query(
    `SELECT * FROM player_ability_snapshots
      WHERE user_id = $1 AND game_id = $2
      ORDER BY computed_at DESC
      LIMIT 1`,
    [userId, gameId],
  );
  return snapshotView(rows[0] || null);
}

// Prior base-metric values within the trend window, for computeTrend7d().
async function trendBaseSeries(userId, gameId, deviceClass, sinceIso, database = db) {
  const { rows } = await database.query(
    `SELECT (metrics->>'vocab_level_estimate')::float8 AS value
       FROM player_ability_snapshots
      WHERE user_id = $1 AND game_id = $2
        AND device_class IS NOT DISTINCT FROM $3
        AND computed_at >= $4
      ORDER BY computed_at ASC`,
    [userId, gameId, deviceClass ?? null, sinceIso],
  );
  return rows.map((r) => r.value).filter((v) => Number.isFinite(v));
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

// Compute and persist an ability snapshot for a user + game.
// gameId '_all' aggregates across games. deviceClass narrows to one device
// stratum (§5); when omitted the dominant device_class in-window is recorded.
async function computeAbilitySnapshot(userId, gameId, options = {}) {
  const database = options.database || db;
  const now = options.now ? new Date(options.now) : new Date();
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const windowEnd = now;
  const windowStart = new Date(now.getTime() - windowDays * DAY_MS);

  const params = [userId];
  const clauses = ['ps.user_id = $1'];
  if (gameId !== ALL_GAMES) {
    params.push(gameId);
    clauses.push(`ps.game_id = $${params.length}`);
  }
  if (options.deviceClass) {
    params.push(options.deviceClass);
    clauses.push(`ps.metadata->>'device_class' = $${params.length}`);
  }
  params.push(CONSUMED_EVENT_TYPES);
  clauses.push(`pe.event_type = ANY($${params.length})`);
  params.push(windowStart.toISOString());
  clauses.push(`pe.occurred_at >= $${params.length}`);
  params.push(windowEnd.toISOString());
  clauses.push(`pe.occurred_at <= $${params.length}`);

  const { rows } = await database.query(
    `SELECT pe.event_type, pe.event_data, pe.occurred_at,
            ps.metadata->>'device_class' AS device_class
       FROM play_events pe
       JOIN play_sessions ps ON pe.session_id = ps.id
      WHERE ${clauses.join(' AND ')}
      ORDER BY pe.occurred_at ASC`,
    params,
  );

  const trials = [];
  const calibrationFirstInputs = [];
  const deviceCounts = new Map();
  for (const row of rows) {
    if (row.device_class) deviceCounts.set(row.device_class, (deviceCounts.get(row.device_class) || 0) + 1);
    if (isTrialResultType(row.event_type)) {
      trials.push({ ...extractTrial(row.event_data), occurredAtMs: new Date(row.occurred_at).getTime() });
    } else if (isCalibrationType(row.event_type)) {
      const list = Array.isArray(row.event_data?.trials) ? row.event_data.trials : [];
      for (const c of list) {
        const v = Number(c?.first_input_ms);
        if (Number.isFinite(v)) calibrationFirstInputs.push(v);
      }
    }
  }

  const deviceClass = options.deviceClass
    || [...deviceCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    || null;

  const { metrics, sampleTrials } = computeAbilityMetrics(trials, calibrationFirstInputs, { now: now.getTime() });

  // trend_7d from prior snapshots + the value just computed.
  const trendSince = new Date(now.getTime() - 7 * DAY_MS).toISOString();
  const prior = await trendBaseSeries(userId, gameId, deviceClass, trendSince, database);
  metrics.trend_7d = computeTrend7d([...prior, metrics.vocab_level_estimate].filter((v) => Number.isFinite(v)));

  return saveAbilitySnapshot({
    userId,
    gameId,
    deviceClass,
    metrics,
    sampleTrials,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
  }, database);
}

module.exports = {
  ALGO_VERSION,
  ALL_GAMES,
  LOW_SAMPLE_THRESHOLD,
  VOCAB_ACCURACY_TARGET,
  // pure
  median,
  weightedPercentile,
  weightedMean,
  weightedTrimmedMean,
  weightedProportion,
  weightedCoefficientOfVariation,
  computeFreshnessWeight,
  enrichTrial,
  estimateVocabLevel,
  computeTrend7d,
  computeAbilityMetrics,
  // db
  snapshotView,
  saveAbilitySnapshot,
  getLatestAbilitySnapshot,
  computeAbilitySnapshot,
};
