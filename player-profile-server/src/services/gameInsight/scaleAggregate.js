// Cross-player GEQ / PENS statistics for one game
// (spec/feature/game-experience-scales.md §横断集計). Ordinal first: every
// player's subscale scores are re-expressed against that player's own
// baseline over *all* their impressions (every game), then the player's
// impressions of this game are averaged (one player = one vote), then players
// are averaged. The raw mean is kept beside the ordinal one so a reader can
// see both "how high" and "how much higher than usual". Pure and deterministic.
const { SCALE_FAMILIES } = require('../gameExperienceScales/scaleDefinitions');
const { scoreScales } = require('../gameExperienceScales/scaleScores');
const { normalizeWithinPlayer } = require('../ordinal/withinPlayer');
const { normalizeTitle } = require('./cohortReader');

const SCALE_AGGREGATE_EXTRACTOR = 'scale-aggregate-ordinal/v1';

function mean(values) {
  const xs = values.filter(Number.isFinite);
  return xs.length === 0 ? null : xs.reduce((sum, value) => sum + value, 0) / xs.length;
}

function round(value, digits = 4) {
  return value === null ? null : Number(value.toFixed(digits));
}

function subscaleKeys() {
  return Object.values(SCALE_FAMILIES).flatMap((family) => family.subscales
    .map((subscale) => ({ family: family.id, subscale: subscale.id, label: subscale.label })));
}

// Scored impressions grouped per player, each flagged whether it is about the
// analyzed game. Players without any scale answers are absent.
/** @implements SPEC-GAME-EXPERIENCE-SCALES */
function groupScoredByPlayer(items, title) {
  const byPlayer = new Map();
  for (const { playerKey, record } of items) {
    const scored = scoreScales(record?.scales);
    if (!scored) continue;
    const group = byPlayer.get(playerKey) || [];
    group.push({ scored, isTarget: normalizeTitle(record.gameTitle) === title });
    byPlayer.set(playerKey, group);
  }
  return byPlayer;
}

function subscaleScore(item, key) {
  return item.scored[key.family]?.[key.subscale]?.score ?? null;
}

// One player's vote for one subscale: their target-game mean expressed raw,
// as z against all their impressions, and as percentile rank. Null when the
// player did not answer this subscale for the target game.
/** @implements SPEC-GAME-EXPERIENCE-SCALES */
function playerVote(group, targets, key) {
  const own = targets.map((item) => subscaleScore(item, key));
  if (!own.some(Number.isFinite)) return null;
  const ordinal = normalizeWithinPlayer(own, group.map((item) => subscaleScore(item, key)));
  return { raw: mean(own), z: mean(ordinal.z), rank: mean(ordinal.rank) };
}

// Cross-player mean of the votes, shaped per family for the record / UI.
/** @implements SPEC-GAME-EXPERIENCE-SCALES */
function familiesFromVotes(keys, votesByKey) {
  const families = {};
  for (const key of keys) {
    const votes = votesByKey.get(`${key.family}.${key.subscale}`);
    if (votes.length === 0) continue;
    families[key.family] = families[key.family] || {
      label: SCALE_FAMILIES[key.family].label,
      range: SCALE_FAMILIES[key.family].range,
      subscales: {},
    };
    families[key.family].subscales[key.subscale] = {
      label: key.label,
      raw: round(mean(votes.map((vote) => vote.raw))),
      z: round(mean(votes.map((vote) => vote.z))),
      rank: round(mean(votes.map((vote) => vote.rank))),
      playerCount: votes.length,
    };
  }
  return families;
}

// `items` = every voice record of every player (`{ playerKey, record }`),
// `gameTitle` = the game being analyzed. Returns null when no player rated the
// game on any scale.
/** @implements SPEC-GAME-EXPERIENCE-SCALES */
function aggregateScales(items, gameTitle) {
  const title = normalizeTitle(gameTitle);
  const keys = subscaleKeys();
  const votesByKey = new Map(keys.map((key) => [`${key.family}.${key.subscale}`, []]));
  let ratingPlayers = 0;
  let ratingRecords = 0;
  for (const group of groupScoredByPlayer(items, title).values()) {
    const targets = group.filter((item) => item.isTarget);
    if (targets.length === 0) continue;
    ratingPlayers += 1;
    ratingRecords += targets.length;
    for (const key of keys) {
      const vote = playerVote(group, targets, key);
      if (vote) votesByKey.get(`${key.family}.${key.subscale}`).push(vote);
    }
  }
  if (ratingPlayers === 0) return null;
  return {
    extractor: SCALE_AGGREGATE_EXTRACTOR,
    playerCount: ratingPlayers,
    recordCount: ratingRecords,
    families: familiesFromVotes(keys, votesByKey),
  };
}

module.exports = { SCALE_AGGREGATE_EXTRACTOR, aggregateScales };
