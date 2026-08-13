// Pure timeline assembly for capture sessions: gaze samples are binned into
// attention metrics and merged with markers/anchors on the shared sessionMs
// axis (spec/feature/emotion-capture-companion.md). No I/O here so the shape of
// the timeline is fully unit-testable.
const DEFAULT_BIN_MS = 5000;

function isOnScreen(sample) {
  return sample.valid && sample.x >= 0 && sample.x <= 1 && sample.y >= 0 && sample.y <= 1;
}

// Root-mean-square distance from the bin centroid, in normalized screen units.
// Tight fixation clusters score near 0; scanning the whole screen approaches ~0.5.
function dispersionOf(points) {
  if (points.length === 0) return null;
  const centroidX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const centroidY = points.reduce((sum, p) => sum + p.y, 0) / points.length;
  const meanSquare = points.reduce(
    (sum, p) => sum + (p.x - centroidX) ** 2 + (p.y - centroidY) ** 2,
    0
  ) / points.length;
  return Math.sqrt(meanSquare);
}

function aggregateGazeBins(samples, binMs = DEFAULT_BIN_MS) {
  if (!Number.isInteger(binMs) || binMs <= 0) throw new TypeError('binMs must be a positive integer');
  const bins = new Map();
  for (const sample of samples) {
    if (!Number.isFinite(sample.sessionMs) || sample.sessionMs < 0) continue;
    const start = Math.floor(sample.sessionMs / binMs) * binMs;
    const bin = bins.get(start) || [];
    bin.push(sample);
    bins.set(start, bin);
  }
  return [...bins.entries()]
    .sort(([left], [right]) => left - right)
    .map(([t, binSamples]) => {
      const valid = binSamples.filter((sample) => sample.valid);
      const onScreen = binSamples.filter(isOnScreen);
      const dispersion = dispersionOf(onScreen);
      const onScreenRatio = binSamples.length ? onScreen.length / binSamples.length : 0;
      // focusScore folds "was the player looking at the screen" and "how
      // concentrated was the gaze" into one 0..1 value for the UI sparkline.
      const focusScore = dispersion === null
        ? 0
        : onScreenRatio * (1 - Math.min(dispersion * 2, 1));
      return {
        t,
        n: binSamples.length,
        validRatio: Number((valid.length / binSamples.length).toFixed(4)),
        onScreenRatio: Number(onScreenRatio.toFixed(4)),
        dispersion: dispersion === null ? null : Number(dispersion.toFixed(4)),
        focusScore: Number(focusScore.toFixed(4)),
      };
    });
}

function buildTimeline({ session, gazeSamples = [], binMs = DEFAULT_BIN_MS }) {
  const startedAtMs = Date.parse(session.startedAt);
  const endedAtMs = session.endedAt ? Date.parse(session.endedAt) : null;
  const markerMax = session.markers.reduce((max, marker) => Math.max(max, marker.sessionMs), 0);
  const gazeMax = gazeSamples.reduce((max, sample) => Math.max(max, sample.sessionMs), 0);
  const durationMs = endedAtMs !== null
    ? Math.max(endedAtMs - startedAtMs, 0)
    : Math.max(markerMax, gazeMax);
  return {
    sessionId: session.id,
    gameTitle: session.gameTitle,
    status: session.status,
    durationMs,
    binMs,
    gaze: aggregateGazeBins(gazeSamples, binMs),
    markers: [...session.markers].sort((left, right) => left.sessionMs - right.sessionMs),
    anchors: [...session.anchors].sort((left, right) => left.sessionMs - right.sessionMs),
  };
}

module.exports = { DEFAULT_BIN_MS, aggregateGazeBins, buildTimeline };
