// Where do sessions stop? (spec/feature/game-insight.md §集約 脱落点). Builds a
// survival curve over the shared progress axis from each time-axis session's
// end position and ranks the bins where endings cluster. An ending in the last
// bin is the longest session's own goal line — reported as `completion`, not as
// a dropout. Memory sketches (no end position) are skipped. Pure.
const { nearestBin } = require('./hotspotSeries');

const MAXIMUM_DROPOUTS = 5;
// Bins before the end whose mean valence is reported as the "exit mood".
const EXIT_BINS = 2;

/** @implements SPEC-GAME-INSIGHT */
function exitValence(session, endBin) {
  const values = [];
  for (let bin = Math.max(0, endBin - EXIT_BINS + 1); bin <= endBin; bin += 1) {
    const value = session.series.valence[bin];
    if (Number.isFinite(value)) values.push(value);
  }
  if (values.length === 0) return null;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4));
}

/** @implements SPEC-GAME-INSIGHT */
function analyzeDropouts(sessions, { binCount, centers }) {
  const timed = sessions.filter((session) => Number.isFinite(session.endPosition));
  const endings = timed.map((session) => ({
    session,
    bin: nearestBin(session.endPosition, binCount),
  }));
  const survival = centers.map((center) => {
    if (timed.length === 0) return null;
    const alive = timed.filter((session) => session.endPosition >= center).length;
    return Number((alive / timed.length).toFixed(4));
  });

  const byBin = new Map();
  for (const ending of endings) {
    const group = byBin.get(ending.bin) || [];
    group.push(ending);
    byBin.set(ending.bin, group);
  }
  const lastBin = binCount - 1;
  const completionGroup = byBin.get(lastBin) || [];
  const dropouts = [...byBin.entries()]
    .filter(([bin]) => bin !== lastBin)
    .map(([bin, group]) => {
      const exits = group.map(({ session }) => exitValence(session, bin)).filter(Number.isFinite);
      return {
        bin,
        position: Number(centers[bin].toFixed(4)),
        sessionCount: group.length,
        playerCount: new Set(group.map(({ session }) => session.playerKey)).size,
        share: Number((group.length / timed.length).toFixed(4)),
        exitValence: exits.length > 0
          ? Number((exits.reduce((sum, value) => sum + value, 0) / exits.length).toFixed(4))
          : null,
        recordIds: group.map(({ session }) => session.recordId).sort(),
      };
    })
    .sort((left, right) => right.sessionCount - left.sessionCount || left.bin - right.bin)
    .slice(0, MAXIMUM_DROPOUTS);

  return {
    timedSessionCount: timed.length,
    survival,
    dropouts,
    completion: {
      sessionCount: completionGroup.length,
      playerCount: new Set(completionGroup.map(({ session }) => session.playerKey)).size,
      share: timed.length > 0 ? Number((completionGroup.length / timed.length).toFixed(4)) : null,
    },
  };
}

module.exports = { EXIT_BINS, MAXIMUM_DROPOUTS, analyzeDropouts, exitValence };
