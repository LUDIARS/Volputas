// Turns one emotion-curve record into a resampled affect series on a shared
// 0..1 progress axis (spec/feature/narrative-arc.md §正規化). Video and
// capture curves are placed by timeSeconds over the session length, memory
// sketches already carry a 0..100% position. Pure: no I/O, deterministic for a
// given record, so the aggregate stage can be unit-tested bin by bin.
const DEFAULT_BIN_COUNT = 20;
// Kernel width on the 0..1 axis. Entries are sparse (a handful per session), so
// each one should influence roughly its neighbouring bins, not just its own.
const DEFAULT_BANDWIDTH = 0.08;
// Below this total kernel weight a bin has no real evidence and stays null
// instead of being extrapolated from a far-away entry.
const MINIMUM_BIN_WEIGHT = 0.05;

/** @implements SPEC-NARRATIVE-ARC */
function sessionDurationSeconds(record) {
  const entryMax = (record.entries || []).reduce(
    (max, entry) => Math.max(max, Number(entry.timeSeconds) || 0),
    0
  );
  const declared = Number(record.sessionPlaytimeMinutes);
  if (Number.isFinite(declared) && declared > 0) {
    // The declared session length wins unless entries run past it (a rounded
    // playtime must not clip the last entries beyond 100%).
    return Math.max(declared * 60, entryMax);
  }
  return entryMax;
}

/** @implements SPEC-NARRATIVE-ARC */
function normalizeCurve(record) {
  const entries = Array.isArray(record.entries) ? record.entries : [];
  const duration = record.mode === 'memory' ? null : sessionDurationSeconds(record);
  const points = entries
    .map((entry) => {
      const position = record.mode === 'memory'
        ? Number(entry.position) / 100
        : duration > 0 ? (Number(entry.timeSeconds) || 0) / duration : 0;
      return {
        position: Math.min(Math.max(position, 0), 1),
        valence: Number(entry.valence) || 0,
        arousal: Number(entry.arousal) || 3,
        stamp: entry.stamp || null,
        comment: entry.comment || '',
      };
    })
    .sort((left, right) => left.position - right.position);
  return {
    recordId: record.id,
    sessionLabel: record.sessionLabel || '',
    mode: record.mode || 'video',
    createdAt: record.createdAt || null,
    daysAfterPlay: record.daysAfterPlay ?? null,
    totalPlaytimeHours: record.totalPlaytimeHours ?? null,
    sessionPlaytimeMinutes: record.sessionPlaytimeMinutes ?? null,
    declaredArc: record.narrativeArc || '',
    durationSeconds: duration,
    points,
  };
}

/** @implements SPEC-NARRATIVE-ARC */
function binCenters(binCount) {
  return Array.from({ length: binCount }, (_, index) => (index + 0.5) / binCount);
}

// Gaussian-kernel weighted mean of valence/arousal at each bin centre.
/** @implements SPEC-NARRATIVE-ARC */
function resampleSeries(points, { binCount = DEFAULT_BIN_COUNT, bandwidth = DEFAULT_BANDWIDTH } = {}) {
  if (!Number.isInteger(binCount) || binCount < 2) throw new TypeError('binCount must be an integer >= 2');
  const centers = binCenters(binCount);
  const valence = [];
  const arousal = [];
  const weight = [];
  for (const center of centers) {
    let totalWeight = 0;
    let valenceSum = 0;
    let arousalSum = 0;
    for (const point of points) {
      const distance = (point.position - center) / bandwidth;
      const kernel = Math.exp(-0.5 * distance * distance);
      totalWeight += kernel;
      valenceSum += kernel * point.valence;
      arousalSum += kernel * point.arousal;
    }
    if (totalWeight < MINIMUM_BIN_WEIGHT) {
      valence.push(null);
      arousal.push(null);
      weight.push(0);
    } else {
      valence.push(Number((valenceSum / totalWeight).toFixed(4)));
      arousal.push(Number((arousalSum / totalWeight).toFixed(4)));
      weight.push(Number(totalWeight.toFixed(4)));
    }
  }
  return { centers, valence, arousal, weight };
}

/** @implements SPEC-NARRATIVE-ARC */
function summarizePoints(points) {
  if (points.length === 0) {
    return { entryCount: 0, meanValence: null, meanArousal: null, peakPosition: null, stampCounts: {} };
  }
  const meanValence = points.reduce((sum, point) => sum + point.valence, 0) / points.length;
  const meanArousal = points.reduce((sum, point) => sum + point.arousal, 0) / points.length;
  const peak = points.reduce((best, point) => (point.valence > best.valence ? point : best), points[0]);
  const stampCounts = {};
  for (const point of points) {
    if (point.stamp) stampCounts[point.stamp] = (stampCounts[point.stamp] || 0) + 1;
  }
  return {
    entryCount: points.length,
    meanValence: Number(meanValence.toFixed(4)),
    meanArousal: Number(meanArousal.toFixed(4)),
    peakPosition: Number(peak.position.toFixed(4)),
    stampCounts,
  };
}

/** @implements SPEC-NARRATIVE-ARC */
function buildSessionSeries(record, options) {
  const normalized = normalizeCurve(record);
  return {
    ...normalized,
    series: resampleSeries(normalized.points, options),
    summary: summarizePoints(normalized.points),
  };
}

module.exports = {
  DEFAULT_BANDWIDTH,
  DEFAULT_BIN_COUNT,
  MINIMUM_BIN_WEIGHT,
  binCenters,
  buildSessionSeries,
  normalizeCurve,
  resampleSeries,
  sessionDurationSeconds,
  summarizePoints,
};
