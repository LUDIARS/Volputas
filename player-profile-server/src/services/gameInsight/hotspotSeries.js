// Places every player's emotion-curve sessions on one shared progress axis
// (spec/feature/game-insight.md §進行軸と正規化). Unlike the narrative arc,
// which stretches each session to 0..1, this axis is absolute play time over
// the longest session (the "reference length"), so a session that stops early
// visibly ends early — that is the evidence the dropout statistics need.
// Memory sketches carry a 0..100% position and are placed as-is but never
// contribute an end position. Pure and deterministic.
const {
  DEFAULT_BIN_COUNT,
  binCenters,
  resampleSeries,
  sessionDurationSeconds,
} = require('../narrativeArc/arcSeries');

const TIME_MODES = new Set(['video', 'capture']);
const MAXIMUM_ENTRIES = 500;
const MAXIMUM_TIME_SECONDS = 864000;

/** @implements SPEC-GAME-INSIGHT */
function recordEntries(record) {
  return Array.isArray(record?.entries)
    ? record.entries.filter((entry) => entry && typeof entry === 'object').slice(0, MAXIMUM_ENTRIES)
    : [];
}

/** @implements SPEC-GAME-INSIGHT */
function boundedNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

/** @implements SPEC-GAME-INSIGHT */
function safeSessionDurationSeconds(record) {
  const entries = recordEntries(record).map((entry) => ({
    ...entry,
    timeSeconds: boundedNumber(entry.timeSeconds, 0, 0, MAXIMUM_TIME_SECONDS),
  }));
  return sessionDurationSeconds({ ...record, entries });
}

/** @implements SPEC-GAME-INSIGHT */
function isTimeAxis(record) {
  return TIME_MODES.has(record.mode || 'video');
}

// Longest time-axis session. Zero when only memory sketches exist.
/** @implements SPEC-GAME-INSIGHT */
function referenceLengthSeconds(records) {
  return records.reduce((max, record) => (
    isTimeAxis(record)
      ? Math.max(max, safeSessionDurationSeconds(record))
      : max
  ), 0);
}

/** @implements SPEC-GAME-INSIGHT */
function nearestBin(position, binCount) {
  return Math.min(binCount - 1, Math.max(0, Math.floor(position * binCount)));
}

/** @implements SPEC-GAME-INSIGHT */
function placeEntries(record, referenceLength) {
  const entries = recordEntries(record);
  const timeAxis = isTimeAxis(record);
  return entries
    .map((entry) => {
      let position;
      if (timeAxis) {
        position = referenceLength > 0
          ? boundedNumber(entry.timeSeconds, 0, 0, MAXIMUM_TIME_SECONDS) / referenceLength
          : 0;
      } else {
        position = boundedNumber(entry.position, 0, 0, 100) / 100;
      }
      return {
        position: Math.min(Math.max(position, 0), 1),
        timeSeconds: timeAxis
          ? boundedNumber(entry.timeSeconds, 0, 0, MAXIMUM_TIME_SECONDS)
          : null,
        valence: boundedNumber(entry.valence, 0, -2, 2),
        arousal: boundedNumber(entry.arousal, 3, 1, 5),
        stamp: typeof entry.stamp === 'string' ? entry.stamp : null,
        comment: typeof entry.comment === 'string' ? entry.comment : '',
      };
    })
    .sort((left, right) => left.position - right.position);
}

/** @implements SPEC-GAME-INSIGHT */
function clipToEnd(series, endPosition, binCount) {
  if (!Number.isFinite(endPosition)) return series;
  const lastBin = nearestBin(endPosition, binCount);
  return {
    ...series,
    valence: series.valence.map((value, bin) => (bin <= lastBin ? value : null)),
    arousal: series.arousal.map((value, bin) => (bin <= lastBin ? value : null)),
    weight: series.weight.map((value, bin) => (bin <= lastBin ? value : 0)),
  };
}

/** @implements SPEC-GAME-INSIGHT */
function buildCohortSession({ playerKey, record }, referenceLength, { binCount = DEFAULT_BIN_COUNT } = {}) {
  const timeAxis = isTimeAxis(record);
  const points = placeEntries(record, referenceLength);
  const durationSeconds = timeAxis
    ? safeSessionDurationSeconds(record)
    : null;
  const endPosition = timeAxis && referenceLength > 0
    ? Math.min(1, durationSeconds / referenceLength)
    : null;
  const stampedBins = points
    .filter((point) => point.stamp)
    .map((point) => ({ bin: nearestBin(point.position, binCount), stamp: point.stamp }));
  // The kernel would smear the last entry past the session's end; a session
  // that stopped carries no evidence beyond its end position.
  const series = clipToEnd(resampleSeries(points, { binCount }), endPosition, binCount);
  return {
    playerKey,
    recordId: record.id,
    sessionLabel: record.sessionLabel || '',
    mode: record.mode || 'video',
    createdAt: record.createdAt || null,
    captureSessionId: record.captureSessionId || null,
    durationSeconds,
    endPosition,
    points,
    series,
    stampedBins,
  };
}

/** @implements SPEC-GAME-INSIGHT */
function buildCohortSessions(items, { binCount = DEFAULT_BIN_COUNT } = {}) {
  const referenceLength = referenceLengthSeconds(items.map((item) => item.record));
  return {
    referenceLengthSeconds: referenceLength,
    binCount,
    centers: binCenters(binCount),
    sessions: items.map((item) => buildCohortSession(item, referenceLength, { binCount })),
  };
}

module.exports = {
  buildCohortSession,
  clipToEnd,
  buildCohortSessions,
  isTimeAxis,
  nearestBin,
  placeEntries,
  referenceLengthSeconds,
};
