const {
  VECTOR_SPEC_VERSION,
  scoreText,
  textToVector,
  weightedMean,
} = require('@ludiars/sentiment-core');
const db = require('../config/database');
const { isTrialResultType, isCorrectOutcome } = require('./trialResult');

const ALGO_VERSION = 1;

function hasLexiconSignal(text) {
  const score = scoreText(text);
  return score.valence !== 0
    || score.arousal !== 0
    || score.emotions.length > 0
    || score.aspectsHit.length > 0;
}

function aggregateTimeline(utterances, binMs = 30_000) {
  if (!Number.isInteger(binMs) || binMs <= 0) throw new TypeError('binMs must be a positive integer');
  const bins = new Map();
  let eligible = 0;
  let lexicalHits = 0;
  for (const utterance of utterances) {
    if (!Number.isFinite(utterance.videoOffsetMs) || utterance.videoOffsetMs < 0) continue;
    if (typeof utterance.content !== 'string' || !utterance.content.trim()) continue;
    eligible += 1;
    if (hasLexiconSignal(utterance.content)) lexicalHits += 1;
    const start = Math.floor(utterance.videoOffsetMs / binMs) * binMs;
    const bin = bins.get(start) || [];
    bin.push(textToVector(utterance.content));
    bins.set(start, bin);
  }
  const series = [...bins.entries()]
    .sort(([left], [right]) => left - right)
    .map(([t, vectors]) => ({
      t,
      vector: weightedMean(vectors, vectors.map(() => 1)),
      n: vectors.length,
      density: Number((vectors.length / (binMs / 1000)).toFixed(6)),
    }));
  return {
    series,
    meta: {
      eligibleComments: eligible,
      lexiconHits: lexicalHits,
      lexiconHitRate: eligible ? Number((lexicalHits / eligible).toFixed(4)) : 0,
    },
  };
}

function aggregatePlaySession(events, binMs = 30_000) {
  if (!Number.isInteger(binMs) || binMs <= 0) throw new TypeError('binMs must be a positive integer');
  const bins = new Map();
  for (const event of events) {
    if (!Number.isFinite(event.monoMs) || event.monoMs < 0) continue;
    const start = Math.floor(event.monoMs / binMs) * binMs;
    const bin = bins.get(start) || { events: 0, attempts: 0, correct: 0, retries: 0 };
    bin.events += 1;
    // Recognise the §6.4 trial_result shape (outcome/corrections) as well as the
    // legacy bare `trial_result` + correct/retries payload the timeline shipped with.
    if (isTrialResultType(event.eventType)) {
      bin.attempts += 1;
      if (isCorrectOutcome(event.eventData)) bin.correct += 1;
      bin.retries += Number(event.eventData?.corrections ?? event.eventData?.retries) || 0;
    }
    bins.set(start, bin);
  }
  return [...bins.entries()]
    .sort(([left], [right]) => left - right)
    .map(([t, metrics]) => ({
      t,
      metrics: {
        ...metrics,
        accuracy: metrics.attempts ? Number((metrics.correct / metrics.attempts).toFixed(4)) : null,
      },
    }));
}

async function saveTimeline({
  gameId,
  sourceKind,
  sourceRef,
  binMs,
  series,
  meta = {},
}, database = db) {
  const { rows } = await database.query(
    `INSERT INTO affect_timelines
       (game_id, source_kind, source_ref, bin_ms, series, analysis_meta,
        vector_spec_version, algo_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (source_kind, source_ref, bin_ms, algo_version)
     DO UPDATE SET game_id = EXCLUDED.game_id,
                   series = EXCLUDED.series,
                   analysis_meta = EXCLUDED.analysis_meta,
                   vector_spec_version = EXCLUDED.vector_spec_version,
                   created_at = now()
     RETURNING *`,
    [
      gameId,
      sourceKind,
      sourceRef,
      binMs,
      JSON.stringify(series),
      JSON.stringify(meta),
      VECTOR_SPEC_VERSION,
      ALGO_VERSION,
    ]
  );
  return rows[0];
}

async function listTimelines(gameId, database = db) {
  const { rows } = await database.query(
    `SELECT id, game_id, source_kind, source_ref, bin_ms, analysis_meta,
            vector_spec_version, algo_version, created_at
     FROM affect_timelines WHERE game_id = $1 ORDER BY created_at DESC`,
    [gameId]
  );
  return rows;
}

async function getTimeline(id, database = db) {
  const { rows } = await database.query('SELECT * FROM affect_timelines WHERE id = $1', [id]);
  return rows[0] || null;
}

module.exports = {
  ALGO_VERSION,
  aggregatePlaySession,
  aggregateTimeline,
  getTimeline,
  listTimelines,
  saveTimeline,
};
