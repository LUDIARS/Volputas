// Cross-session narrative arc for one game and one player
// (spec/feature/narrative-arc.md §集約). Takes the per-session series from
// arcSeries.js and derives the mean arc, its shape (Reagan et al.'s six story
// arcs as templates), peak/valley/ending structure and the trend across
// sessions. Deterministic and pure; the LLM commentary is a separate stage.
const { binCenters } = require('./arcSeries');

// The six basic emotional arcs, as valence over normalized progress in -1..1.
// Order matters only for display; classification is by correlation.
const ARC_ARCHETYPES = Object.freeze([
  { id: 'rags-to-riches', label: '右肩上がり (Rags to riches)', shape: (t) => 2 * t - 1 },
  { id: 'riches-to-rags', label: '右肩下がり (Riches to rags)', shape: (t) => 1 - 2 * t },
  { id: 'man-in-a-hole', label: '落ちて戻る (Man in a hole)', shape: (t) => Math.cos(2 * Math.PI * t) },
  { id: 'icarus', label: '上がって落ちる (Icarus)', shape: (t) => -Math.cos(2 * Math.PI * t) },
  { id: 'cinderella', label: '上がって落ちて上がる (Cinderella)', shape: (t) => -Math.cos(3 * Math.PI * t) },
  { id: 'oedipus', label: '落ちて上がって落ちる (Oedipus)', shape: (t) => Math.cos(3 * Math.PI * t) },
]);

// Fewer covered bins than this and a shape label would be noise.
const MINIMUM_SHAPE_BINS = 4;
const MINIMUM_SESSIONS = 2;
// Number of trailing bins that count as "the ending" for peak-end scoring.
const ENDING_BINS = 3;

/** @implements SPEC-NARRATIVE-ARC */
function pearson(xs, ys) {
  const pairs = xs.map((x, index) => [x, ys[index]])
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (pairs.length < 2) return null;
  const meanX = pairs.reduce((sum, [x]) => sum + x, 0) / pairs.length;
  const meanY = pairs.reduce((sum, [, y]) => sum + y, 0) / pairs.length;
  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;
  for (const [x, y] of pairs) {
    covariance += (x - meanX) * (y - meanY);
    varianceX += (x - meanX) ** 2;
    varianceY += (y - meanY) ** 2;
  }
  if (varianceX === 0 || varianceY === 0) return null;
  return covariance / Math.sqrt(varianceX * varianceY);
}

/** @implements SPEC-NARRATIVE-ARC */
function meanAndDeviation(values) {
  const present = values.filter((value) => Number.isFinite(value));
  if (present.length === 0) return { mean: null, deviation: null, n: 0 };
  const mean = present.reduce((sum, value) => sum + value, 0) / present.length;
  const variance = present.reduce((sum, value) => sum + (value - mean) ** 2, 0) / present.length;
  return {
    mean: Number(mean.toFixed(4)),
    deviation: Number(Math.sqrt(variance).toFixed(4)),
    n: present.length,
  };
}

/** @implements SPEC-NARRATIVE-ARC */
function classifyShape(centers, meanValence) {
  const covered = meanValence.filter((value) => Number.isFinite(value)).length;
  if (covered < MINIMUM_SHAPE_BINS) {
    return { archetype: null, label: '判定不能 (データ不足)', correlation: null, candidates: [] };
  }
  const candidates = ARC_ARCHETYPES
    .map((archetype) => ({
      id: archetype.id,
      label: archetype.label,
      correlation: pearson(meanValence, centers.map(archetype.shape)),
    }))
    .filter((candidate) => candidate.correlation !== null)
    .map((candidate) => ({ ...candidate, correlation: Number(candidate.correlation.toFixed(4)) }))
    .sort((left, right) => right.correlation - left.correlation);
  if (candidates.length === 0) {
    // A perfectly flat mean arc correlates with nothing.
    return { archetype: 'flat', label: '平坦 (起伏なし)', correlation: null, candidates: [] };
  }
  const [best] = candidates;
  return { archetype: best.id, label: best.label, correlation: best.correlation, candidates };
}

/** @implements SPEC-NARRATIVE-ARC */
function extremes(centers, meanValence) {
  let peak = null;
  let valley = null;
  meanValence.forEach((value, index) => {
    if (!Number.isFinite(value)) return;
    if (peak === null || value > peak.valence) peak = { position: centers[index], valence: value };
    if (valley === null || value < valley.valence) valley = { position: centers[index], valence: value };
  });
  return { peak, valley };
}

/** @implements SPEC-NARRATIVE-ARC */
function endingValence(meanValence) {
  const tail = meanValence.filter((value) => Number.isFinite(value)).slice(-ENDING_BINS);
  if (tail.length === 0) return null;
  return Number((tail.reduce((sum, value) => sum + value, 0) / tail.length).toFixed(4));
}

// Least-squares slope of session mean valence over session order (0-based).
/** @implements SPEC-NARRATIVE-ARC */
function trendSlope(values) {
  const pairs = values.map((value, index) => [index, value]).filter(([, value]) => Number.isFinite(value));
  if (pairs.length < 2) return null;
  const meanX = pairs.reduce((sum, [x]) => sum + x, 0) / pairs.length;
  const meanY = pairs.reduce((sum, [, y]) => sum + y, 0) / pairs.length;
  const numerator = pairs.reduce((sum, [x, y]) => sum + (x - meanX) * (y - meanY), 0);
  const denominator = pairs.reduce((sum, [x]) => sum + (x - meanX) ** 2, 0);
  return denominator === 0 ? null : Number((numerator / denominator).toFixed(4));
}

// Mean pairwise correlation between session valence series: how repeatable
// the arc is for this player on this game.
/** @implements SPEC-NARRATIVE-ARC */
function consistency(sessions) {
  const correlations = [];
  for (let left = 0; left < sessions.length; left += 1) {
    for (let right = left + 1; right < sessions.length; right += 1) {
      const value = pearson(sessions[left].series.valence, sessions[right].series.valence);
      if (value !== null) correlations.push(value);
    }
  }
  if (correlations.length === 0) return null;
  return Number((correlations.reduce((sum, value) => sum + value, 0) / correlations.length).toFixed(4));
}

/** @implements SPEC-NARRATIVE-ARC */
function aggregateArc(sessions) {
  if (!Array.isArray(sessions) || sessions.length < MINIMUM_SESSIONS) {
    throw Object.assign(
      new Error(`A narrative arc needs at least ${MINIMUM_SESSIONS} sessions of the same game`),
      { statusCode: 409, code: 'NARRATIVE_ARC_INSUFFICIENT_SESSIONS' }
    );
  }
  const binCount = sessions[0].series.valence.length;
  if (sessions.some((session) => session.series.valence.length !== binCount)) {
    throw new TypeError('All sessions must be resampled with the same bin count');
  }
  const centers = binCenters(binCount);
  const bins = centers.map((center, index) => {
    const valence = meanAndDeviation(sessions.map((session) => session.series.valence[index]));
    const arousal = meanAndDeviation(sessions.map((session) => session.series.arousal[index]));
    return {
      position: Number(center.toFixed(4)),
      valence: valence.mean,
      valenceDeviation: valence.deviation,
      arousal: arousal.mean,
      arousalDeviation: arousal.deviation,
      coverage: valence.n,
    };
  });
  const meanValence = bins.map((bin) => bin.valence);
  const { peak, valley } = extremes(centers, meanValence);
  const ending = endingValence(meanValence);
  const ordered = [...sessions].sort((left, right) =>
    String(left.createdAt || '').localeCompare(String(right.createdAt || '')));
  const sessionMeans = ordered.map((session) => session.summary.meanValence);
  return {
    binCount,
    sessionCount: sessions.length,
    bins,
    shape: classifyShape(centers, meanValence),
    peak,
    valley,
    ending,
    // Kahneman's peak-end rule as a single number: what the player is likely
    // to remember the game by.
    peakEnd: peak && ending !== null ? Number(((peak.valence + ending) / 2).toFixed(4)) : null,
    consistency: consistency(sessions),
    trend: {
      slope: trendSlope(sessionMeans),
      sessionMeans,
      order: ordered.map((session) => session.recordId),
    },
    sessions: ordered.map((session) => ({
      recordId: session.recordId,
      sessionLabel: session.sessionLabel,
      mode: session.mode,
      createdAt: session.createdAt,
      daysAfterPlay: session.daysAfterPlay,
      totalPlaytimeHours: session.totalPlaytimeHours,
      sessionPlaytimeMinutes: session.sessionPlaytimeMinutes,
      declaredArc: session.declaredArc,
      summary: session.summary,
      valence: session.series.valence,
      arousal: session.series.arousal,
    })),
  };
}

module.exports = {
  ARC_ARCHETYPES,
  ENDING_BINS,
  MINIMUM_SESSIONS,
  MINIMUM_SHAPE_BINS,
  aggregateArc,
  classifyShape,
  consistency,
  meanAndDeviation,
  pearson,
  trendSlope,
};
