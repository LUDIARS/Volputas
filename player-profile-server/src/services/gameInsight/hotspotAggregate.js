// Cross-player hotspot statistics for one game
// (spec/feature/game-insight.md §集約). One player = one vote: a player's
// sessions are averaged per bin first, then players are averaged, so a
// talkative player with many sessions does not drown the others. Hotspots are
// bins where arousal stands out (z-score) and enough players contributed;
// valence decides hype vs pain, and stress/dislike stamps from a majority of
// the covering players also mark pain. Deterministic and pure; the LLM
// proposal is a separate stage.
const { EMOTION_STAMPS } = require('../profileEvidenceSchemas');
const { buildCohortSessions, nearestBin } = require('./hotspotSeries');
const { analyzeDropouts } = require('./dropoutAnalysis');

const MINIMUM_SESSIONS = 2;
const HOTSPOT_Z_THRESHOLD = 1;
const MAXIMUM_HOTSPOTS = 8;
const MAXIMUM_QUOTES = 5;
const NEGATIVE_STAMPS = new Set(['stress', 'dislike']);

/** @implements SPEC-GAME-INSIGHT */
function insightError(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

/** @implements SPEC-GAME-INSIGHT */
function mean(values) {
  const present = values.filter(Number.isFinite);
  if (present.length === 0) return null;
  return present.reduce((sum, value) => sum + value, 0) / present.length;
}

/** @implements SPEC-GAME-INSIGHT */
function deviation(values, center) {
  const present = values.filter(Number.isFinite);
  if (present.length === 0 || center === null) return null;
  return Math.sqrt(present.reduce((sum, value) => sum + (value - center) ** 2, 0) / present.length);
}

function round(value, digits = 4) {
  return value === null || value === undefined ? null : Number(value.toFixed(digits));
}

// Per player, per bin: mean of that player's sessions (null if none cover it).
/** @implements SPEC-GAME-INSIGHT */
function perPlayerBins(sessions, binCount) {
  const players = new Map();
  for (const session of sessions) {
    const group = players.get(session.playerKey) || [];
    group.push(session);
    players.set(session.playerKey, group);
  }
  const result = [];
  let index = 0;
  for (const [playerKey, group] of players) {
    index += 1;
    const valence = [];
    const arousal = [];
    for (let bin = 0; bin < binCount; bin += 1) {
      valence.push(mean(group.map((session) => session.series.valence[bin])));
      arousal.push(mean(group.map((session) => session.series.arousal[bin])));
    }
    const stampsByBin = new Map();
    for (const session of group) {
      for (const { bin, stamp } of session.stampedBins) {
        const set = stampsByBin.get(bin) || new Set();
        set.add(stamp);
        stampsByBin.set(bin, set);
      }
    }
    result.push({
      playerKey,
      label: `P${index}`,
      sessionCount: group.length,
      modes: [...new Set(group.map((session) => session.mode))].sort(),
      valence,
      arousal,
      stampsByBin,
      sessions: group,
    });
  }
  return result;
}

/** @implements SPEC-GAME-INSIGHT */
function aggregateBins(players, centers) {
  return centers.map((center, bin) => {
    const valences = players.map((player) => player.valence[bin]);
    const arousals = players.map((player) => player.arousal[bin]);
    const meanValence = mean(valences);
    const valenceDeviation = deviation(valences, meanValence);
    const stampPlayers = {};
    let negativePlayers = 0;
    for (const player of players) {
      const stamps = player.stampsByBin.get(bin) || new Set();
      for (const stamp of stamps) {
        // Imported profile JSON is an input boundary. Ignore unknown stamp keys
        // instead of allowing names such as "__proto__" to touch object internals.
        if (Object.hasOwn(EMOTION_STAMPS, stamp)) {
          stampPlayers[stamp] = (stampPlayers[stamp] || 0) + 1;
        }
      }
      if ([...stamps].some((stamp) => NEGATIVE_STAMPS.has(stamp))) negativePlayers += 1;
    }
    const coverage = valences.filter(Number.isFinite).length;
    return {
      bin,
      position: round(center),
      valence: round(meanValence),
      valenceDeviation: round(valenceDeviation),
      arousal: round(mean(arousals)),
      playerCoverage: coverage,
      // Valence spans -2..2, so a deviation of 2 means players fully disagree.
      agreement: valenceDeviation === null ? null : round(Math.max(0, 1 - valenceDeviation / 2)),
      stampPlayers,
      negativePlayers,
    };
  });
}

// Comments near a bin (the bin itself or its neighbours, since the kernel
// spreads an entry over adjacent bins), at most MAXIMUM_QUOTES, preferring the
// exact bin and one quote per player before repeating a player.
/** @implements SPEC-GAME-INSIGHT */
function quotesForBin(players, bin, binCount) {
  const quotes = [];
  for (const player of players) {
    for (const session of player.sessions) {
      for (const point of session.points) {
        if (!point.comment) continue;
        const distance = Math.abs(nearestBin(point.position, binCount) - bin);
        if (distance > 1) continue;
        quotes.push({
          distance,
          player: player.label,
          position: round(point.position),
          stamp: point.stamp,
          valence: point.valence,
          comment: point.comment.slice(0, 200),
        });
      }
    }
  }
  quotes.sort((left, right) => left.distance - right.distance);
  const seen = new Map();
  const ordered = [];
  for (const quote of quotes) {
    const count = seen.get(quote.player) || 0;
    ordered.push({ rank: count * 2 + quote.distance, quote });
    seen.set(quote.player, count + 1);
  }
  return ordered
    .sort((left, right) => left.rank - right.rank)
    .slice(0, MAXIMUM_QUOTES)
    .map(({ quote: { distance, ...quote } }) => quote);
}

/** @implements SPEC-GAME-INSIGHT */
function detectHotspots(bins, players, { binCount, playerCount }) {
  const minimumCoverage = playerCount >= 2 ? 2 : 1;
  const arousals = bins.map((bin) => bin.arousal);
  const arousalMean = mean(arousals);
  const arousalDeviation = deviation(arousals, arousalMean);
  const hotspots = [];
  bins.forEach((bin, index) => {
    if (bin.playerCoverage < minimumCoverage || bin.arousal === null) return;
    const previous = bins[index - 1]?.arousal ?? -Infinity;
    const next = bins[index + 1]?.arousal ?? -Infinity;
    const z = arousalDeviation > 0 ? (bin.arousal - arousalMean) / arousalDeviation : 0;
    const localMax = bin.arousal >= previous && bin.arousal >= next;
    const negativeVoters = bin.negativePlayers || 0;
    const stampPain = negativeVoters * 2 > bin.playerCoverage && negativeVoters >= minimumCoverage;
    const arousalSpike = z >= HOTSPOT_Z_THRESHOLD && localMax;
    if (!arousalSpike && !stampPain) return;
    const kind = (bin.valence !== null && bin.valence < 0) || (!arousalSpike && stampPain) ? 'pain' : 'hype';
    hotspots.push({
      bin: bin.bin,
      position: bin.position,
      kind,
      score: round(bin.arousal * (bin.playerCoverage / playerCount)),
      arousalZ: round(z, 2),
      valence: bin.valence,
      arousal: bin.arousal,
      playerCount: bin.playerCoverage,
      agreement: bin.agreement,
      stampPlayers: bin.stampPlayers,
      reasons: [arousalSpike ? 'arousal-spike' : null, stampPain ? 'negative-stamps' : null].filter(Boolean),
      quotes: quotesForBin(players, bin.bin, binCount),
    });
  });
  return hotspots
    .sort((left, right) => right.score - left.score || left.bin - right.bin)
    .slice(0, MAXIMUM_HOTSPOTS);
}

/** @implements SPEC-GAME-INSIGHT */
function aggregateHotspots(items, options = {}) {
  if (!Array.isArray(items) || items.length < MINIMUM_SESSIONS) {
    throw insightError(
      409,
      'GAME_INSIGHT_INSUFFICIENT_SESSIONS',
      `At least ${MINIMUM_SESSIONS} emotion curves are needed for hotspot statistics`
    );
  }
  const cohort = buildCohortSessions(items, options);
  const players = perPlayerBins(cohort.sessions, cohort.binCount);
  const bins = aggregateBins(players, cohort.centers);
  const hotspots = detectHotspots(bins, players, {
    binCount: cohort.binCount,
    playerCount: players.length,
  });
  const dropout = analyzeDropouts(cohort.sessions, cohort);
  // What players said right before leaving is the most useful dropout evidence.
  const dropouts = dropout.dropouts.map((item) => ({
    ...item,
    quotes: quotesForBin(players, item.bin, cohort.binCount),
  }));
  return {
    referenceLengthSeconds: cohort.referenceLengthSeconds,
    binCount: cohort.binCount,
    playerCount: players.length,
    sessionCount: cohort.sessions.length,
    singlePlayer: players.length < 2,
    bins,
    hotspots,
    survival: dropout.survival,
    dropouts,
    completion: dropout.completion,
    timedSessionCount: dropout.timedSessionCount,
    players: players.map((player) => ({
      label: player.label,
      sessionCount: player.sessionCount,
      modes: player.modes,
      recordIds: player.sessions.map((session) => session.recordId).sort(),
    })),
    sessions: cohort.sessions.map((session) => ({
      recordId: session.recordId,
      player: players.find((player) => player.playerKey === session.playerKey)?.label || '',
      sessionLabel: session.sessionLabel,
      mode: session.mode,
      createdAt: session.createdAt,
      captureSessionId: session.captureSessionId,
      durationSeconds: session.durationSeconds,
      endPosition: round(session.endPosition),
      entryCount: session.points.length,
    })),
    stampLabels: Object.fromEntries(Object.entries(EMOTION_STAMPS).map(([id, stamp]) => [id, stamp.label])),
  };
}

module.exports = {
  HOTSPOT_Z_THRESHOLD,
  MAXIMUM_HOTSPOTS,
  MINIMUM_SESSIONS,
  aggregateBins,
  aggregateHotspots,
  detectHotspots,
  perPlayerBins,
  quotesForBin,
};
