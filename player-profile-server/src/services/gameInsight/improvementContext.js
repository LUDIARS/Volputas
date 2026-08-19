// Turns hotspot / dropout statistics into "focus points" and joins each with
// what the game itself reported at that moment (spec/feature/game-insight.md
// §改善提案 1-2): the nearest preceding game-origin marker and the game clock
// interpolated from the capture session's anchors. Pure — the capture session
// record is passed in, nothing is read here.
const MAXIMUM_FOCUS_POINTS = 8;
const MAXIMUM_MARKERS = 3;

/** @implements SPEC-GAME-INSIGHT */
function selectFocusPoints(analysis, { maximum = MAXIMUM_FOCUS_POINTS } = {}) {
  const hotspots = (analysis.hotspots || []).map((hotspot) => ({
    type: hotspot.kind, // hype | pain
    position: hotspot.position,
    bin: hotspot.bin,
    score: hotspot.score,
    valence: hotspot.valence,
    arousal: hotspot.arousal,
    playerCount: hotspot.playerCount,
    agreement: hotspot.agreement,
    stampPlayers: hotspot.stampPlayers,
    reasons: hotspot.reasons,
    quotes: hotspot.quotes,
  }));
  const dropouts = (analysis.dropouts || []).map((dropout) => ({
    type: 'dropout',
    position: dropout.position,
    bin: dropout.bin,
    score: dropout.share,
    sessionCount: dropout.sessionCount,
    playerCount: dropout.playerCount,
    exitValence: dropout.exitValence,
    quotes: dropout.quotes || [],
  }));
  // Interleave so neither list starves when the cap is hit: dropouts first by
  // share, hotspots by score, then alternate.
  const merged = [];
  let h = 0;
  let d = 0;
  while (merged.length < maximum && (h < hotspots.length || d < dropouts.length)) {
    if (d < dropouts.length) merged.push(dropouts[d++]);
    if (merged.length < maximum && h < hotspots.length) merged.push(hotspots[h++]);
  }
  // Merge duplicates landing on the same bin (a pain spot that is also a dropout).
  const byBin = new Map();
  for (const point of merged) {
    const existing = byBin.get(point.bin);
    if (!existing) { byBin.set(point.bin, { ...point, types: [point.type] }); continue; }
    existing.types.push(point.type);
    existing.quotes = existing.quotes.length > 0 ? existing.quotes : point.quotes;
    if (point.type === 'dropout') {
      existing.sessionCount = point.sessionCount;
      existing.exitValence = point.exitValence;
    }
  }
  return [...byBin.values()]
    .sort((left, right) => left.position - right.position)
    .map((point, index) => ({ ...point, index: index + 1 }));
}

/** @implements SPEC-GAME-INSIGHT */
function gameClockAt(anchors, sessionMs) {
  const sorted = (anchors || [])
    .filter((anchor) => Number.isFinite(anchor.sessionMs) && Number.isFinite(anchor.gameClockMs))
    .sort((left, right) => left.sessionMs - right.sessionMs);
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return Math.round(sorted[0].gameClockMs + (sessionMs - sorted[0].sessionMs));
  let before = sorted[0];
  let after = sorted[sorted.length - 1];
  for (let index = 0; index < sorted.length - 1; index += 1) {
    if (sorted[index].sessionMs <= sessionMs && sessionMs <= sorted[index + 1].sessionMs) {
      before = sorted[index];
      after = sorted[index + 1];
      break;
    }
  }
  if (sessionMs < sorted[0].sessionMs) { before = sorted[0]; after = sorted[1]; }
  if (sessionMs > sorted[sorted.length - 1].sessionMs) {
    before = sorted[sorted.length - 2];
    after = sorted[sorted.length - 1];
  }
  const span = after.sessionMs - before.sessionMs;
  if (span <= 0) return Math.round(before.gameClockMs);
  const ratio = (sessionMs - before.sessionMs) / span;
  return Math.round(before.gameClockMs + ratio * (after.gameClockMs - before.gameClockMs));
}

// Game-origin markers at or before the moment, most recent first.
/** @implements SPEC-GAME-INSIGHT */
function precedingGameMarkers(markers, sessionMs, { maximum = MAXIMUM_MARKERS } = {}) {
  return (markers || [])
    .filter((marker) => marker.origin === 'game' && Number.isFinite(marker.sessionMs) && marker.sessionMs <= sessionMs)
    .sort((left, right) => right.sessionMs - left.sessionMs)
    .slice(0, maximum)
    .map((marker) => ({
      sessionMs: marker.sessionMs,
      type: marker.type,
      label: marker.label || '',
      secondsBefore: Math.round((sessionMs - marker.sessionMs) / 1000),
    }));
}

/** @implements SPEC-GAME-INSIGHT */
function attachGameContext(focusPoints, { captureSession, referenceLengthSeconds }) {
  return focusPoints.map((point) => {
    const sessionMs = Math.round(point.position * referenceLengthSeconds * 1000);
    if (!captureSession) return { ...point, sessionMs, gameContext: null };
    const screen = captureSession.capture?.screenRecording || null;
    const frameSeconds = screen
      ? (sessionMs - (screen.startSessionMs || 0)) / 1000
      : null;
    return {
      ...point,
      sessionMs,
      gameContext: {
        captureSessionId: captureSession.id,
        gameClockMs: gameClockAt(captureSession.anchors, sessionMs),
        markers: precedingGameMarkers(captureSession.markers, sessionMs),
        frameSeconds: frameSeconds !== null && frameSeconds >= 0
          && (!screen.durationSeconds || frameSeconds <= screen.durationSeconds)
          ? Number(frameSeconds.toFixed(3))
          : null,
      },
    };
  });
}

// Tokens in marker labels that look like code identifiers (candidate symbols
// for Anatomia `find`).
/** @implements SPEC-GAME-INSIGHT */
function identifierTokens(labels) {
  const tokens = new Set();
  for (const label of labels) {
    for (const match of String(label || '').matchAll(/[A-Za-z_][A-Za-z0-9_]{2,}/g)) {
      tokens.add(match[0]);
    }
  }
  return [...tokens].slice(0, 6);
}

module.exports = {
  MAXIMUM_FOCUS_POINTS,
  attachGameContext,
  gameClockAt,
  identifierTokens,
  precedingGameMarkers,
  selectFocusPoints,
};
