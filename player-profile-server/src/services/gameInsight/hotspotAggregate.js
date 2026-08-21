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
const { normalizeWithinPlayer } = require('../ordinal/withinPlayer');

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
    // Ordinal view: the same bins re-expressed against this player's own
    // distribution over every covered bin of every session (ordinal/withinPlayer).
    const valencePool = group.flatMap((session) => session.series.valence);
    const arousalPool = group.flatMap((session) => session.series.arousal);
    const valenceOrdinal = normalizeWithinPlayer(valence, valencePool);
    const arousalOrdinal = normalizeWithinPlayer(arousal, arousalPool);
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
      valenceZ: valenceOrdinal.z,
      arousalZ: arousalOrdinal.z,
      baseline: {
        valence: valenceOrdinal.baseline,
        arousal: arousalOrdinal.baseline,
      },
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
    const valenceZs = players.map((player) => player.valenceZ[bin]);
    const arousalZs = players.map((player) => player.arousalZ[bin]);
    const meanValenceZ = mean(valenceZs);
    const valenceZDeviation = deviation(valenceZs, meanValenceZ);
    return {
      bin,
      position: round(center),
      valence: round(meanValence),
      valenceDeviation: round(valenceDeviation),
      arousal: round(mean(arousals)),
      // Ordinal (within-player standardized) counterparts; what the hotspot
      // detection actually reads.
      valenceZ: round(meanValenceZ),
      arousalZ: round(mean(arousalZs)),
      // 1 when every player is on the same side of their own usual by the
      // same amount; a z spread of 2 is full disagreement.
      agreementOrdinal: valenceZDeviation === null ? null : round(Math.max(0, 1 - valenceZDeviation / 2)),
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

// Ordinal first (spec/feature/game-experience-scales.md §順序化): the spike
// search runs on the within-player standardized arousal (`arousalZ`), so a
// bin is hot when players are above *their own usual* together, not when one
// loud recorder is loud. Pain is a raw negative valence or a clearly
// below-usual one. Records whose ordinal series carries no spike information
// (all null, or flat because every recorder is flat) fall back to the raw
// arousal so older fixtures and single-session cohorts still resolve.
/** @implements SPEC-GAME-EXPERIENCE-SCALES */
function detectionSeries(bins) {
  const ordinal = bins.map((bin) => bin.arousalZ);
  // A flat recorder gets z 0 everywhere (by design in ordinal/withinPlayer), so
  // "some value is finite" is not enough: an all-zero ordinal series carries no
  // spike information and would suppress every hotspot. Fall back to the raw
  // arousal unless the ordinal series actually varies.
  const present = ordinal.filter(Number.isFinite);
  const varies = present.length > 0 && present.some((value) => value !== present[0]);
  return varies
    ? { values: ordinal, basis: 'ordinal' }
    : { values: bins.map((bin) => bin.arousal), basis: 'raw' };
}

/** @implements SPEC-GAME-INSIGHT */
function detectHotspots(bins, players, { binCount, playerCount }) {
  const minimumCoverage = playerCount >= 2 ? 2 : 1;
  const { values: arousals, basis } = detectionSeries(bins);
  const arousalMean = mean(arousals);
  const arousalDeviation = deviation(arousals, arousalMean);
  const hotspots = [];
  bins.forEach((bin, index) => {
    const value = arousals[index];
    // `score` stays on the raw arousal (comparable across games), so a bin
    // without one cannot be ranked even if its ordinal value exists.
    if (bin.playerCoverage < minimumCoverage || !Number.isFinite(value) || bin.arousal === null) return;
    const previous = arousals[index - 1] ?? -Infinity;
    const next = arousals[index + 1] ?? -Infinity;
    const z = arousalDeviation > 0 ? (value - arousalMean) / arousalDeviation : 0;
    const localMax = value >= previous && value >= next;
    const negativeVoters = bin.negativePlayers || 0;
    const stampPain = negativeVoters * 2 > bin.playerCoverage && negativeVoters >= minimumCoverage;
    const arousalSpike = z >= HOTSPOT_Z_THRESHOLD && localMax;
    if (!arousalSpike && !stampPain) return;
    const rawNegative = bin.valence !== null && bin.valence < 0;
    const belowUsual = bin.valenceZ !== null && bin.valenceZ !== undefined && bin.valenceZ <= -HOTSPOT_Z_THRESHOLD;
    const kind = rawNegative || belowUsual || (!arousalSpike && stampPain) ? 'pain' : 'hype';
    hotspots.push({
      bin: bin.bin,
      position: bin.position,
      kind,
      score: round(bin.arousal * (bin.playerCoverage / playerCount)),
      // How far this bin stands out inside the detection series (`detectionBasis`
      // says which one). Distinct from the valenceZ / arousalZ below, which are
      // the within-player "how far above their own usual" values of the bin.
      spikeZ: round(z, 2),
      detectionBasis: basis,
      valence: bin.valence,
      valenceZ: bin.valenceZ ?? null,
      arousal: bin.arousal,
      arousalZ: bin.arousalZ ?? null,
      playerCount: bin.playerCoverage,
      agreement: bin.agreement,
      agreementOrdinal: bin.agreementOrdinal ?? null,
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
