// Steam library snapshot → deterministic evidence features (design §3.2 / T5).
// Passive behavioural data is the heaviest evidence class (total weight 2.5),
// decayed to 0.5 when the snapshot is older than 90 days. Genre features need
// the steam_app_meta cache (§3.2.1, follow-up task) — absent metadata skips
// them without stopping the analysis.
const { STEAM_GENRE_AXIS_MAP } = require('./axisMappings');

const TOTAL_WEIGHT = 2.5;
const STALE_TOTAL_WEIGHT = 0.5;
const STALE_AFTER_DAYS = 90;
// Feature shares of the total weight (sum = 1).
const SHARES = Object.freeze({
  concentration: 0.28,
  breadth: 0.24,
  backlog: 0.2,
  recentActivity: 0.16,
  genres: 0.12,
});
const PLAYED_THRESHOLD_MINUTES = 120;
const BREADTH_FULL_AT_TITLES = 50;
const RECENT_FULL_AT_TITLES = 5;
const BACKLOG_CONFIDENCE_PENALTY_RATE = 0.5;

function clamp01(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function snapshotAgeDays(fetchedAt, analyzedAt) {
  const fetched = Date.parse(fetchedAt);
  const reference = Date.parse(analyzedAt);
  if (!Number.isFinite(fetched) || !Number.isFinite(reference)) return null;
  return (reference - fetched) / (24 * 60 * 60 * 1000);
}

// snapshot: { fetchedAt, games: [{ app_id, name, playtime_forever_minutes,
// playtime_2weeks_minutes }] } — null when the user has no Steam link.
// appMeta: optional { [appId]: { genres: [] } } from the steam_app_meta cache.
function steamContributions(snapshot, analyzedAt, appMeta = null) {
  if (!snapshot || !Array.isArray(snapshot.games) || snapshot.games.length === 0) {
    return { contributions: [], meta: null };
  }
  const games = snapshot.games;
  const ageDays = snapshotAgeDays(snapshot.fetchedAt, analyzedAt);
  const stale = ageDays !== null && ageDays > STALE_AFTER_DAYS;
  const totalWeight = stale ? STALE_TOTAL_WEIGHT : TOTAL_WEIGHT;
  const source = (field) => ({ kind: 'steam', id: snapshot.fetchedAt || null, field });
  const contributions = [];

  const playtimes = games.map((game) => Number(game.playtime_forever_minutes) || 0);
  const totalPlaytime = playtimes.reduce((sum, value) => sum + value, 0);

  // 集中度: top-1 share of total playtime → mastery (high) / explorer (low).
  if (totalPlaytime > 0) {
    const concentration = clamp01(Math.max(...playtimes) / totalPlaytime);
    const weight = totalWeight * SHARES.concentration;
    contributions.push({
      axis: 'style.mastery', value: concentration, weight: weight / 2, source: source('concentration'),
    });
    contributions.push({
      axis: 'style.explorer', value: 1 - concentration, weight: weight / 2, source: source('concentration'),
    });
  }

  // 広さ: log-normalised count of meaningfully played titles → explorer.
  const playedCount = playtimes.filter((value) => value >= PLAYED_THRESHOLD_MINUTES).length;
  contributions.push({
    axis: 'style.explorer',
    value: clamp01(Math.log10(1 + playedCount) / Math.log10(1 + BREADTH_FULL_AT_TITLES)),
    weight: totalWeight * SHARES.breadth,
    source: source('breadth'),
  });

  // 積みゲー率: buying itself is collecting. Not aversion evidence; a high rate
  // instead demotes completion-family confidence (see analyzePersonaV2).
  const backlogRate = clamp01(playtimes.filter((value) => value === 0).length / games.length);
  contributions.push({
    axis: 'style.collector', value: backlogRate, weight: totalWeight * SHARES.backlog, source: source('backlog'),
  });

  // 直近活性: titles with playtime in the last two weeks → routine tolerance.
  const recentCount = games.filter((game) => (Number(game.playtime_2weeks_minutes) || 0) > 0).length;
  contributions.push({
    axis: 'style.routine_tolerance',
    value: clamp01(recentCount / RECENT_FULL_AT_TITLES),
    weight: totalWeight * SHARES.recentActivity,
    source: source('recentActivity'),
  });

  // ジャンル分布 (requires the app-meta cache; skipped when absent).
  if (appMeta) {
    const axisPlaytime = new Map();
    let mappedPlaytime = 0;
    for (const game of games) {
      const playtime = Number(game.playtime_forever_minutes) || 0;
      if (playtime < PLAYED_THRESHOLD_MINUTES) continue;
      const genres = appMeta[game.app_id]?.genres || [];
      for (const genre of genres) {
        const targets = STEAM_GENRE_AXIS_MAP[String(genre).toLowerCase()];
        if (!targets) continue;
        mappedPlaytime += playtime;
        for (const [axis, share] of targets) {
          axisPlaytime.set(axis, (axisPlaytime.get(axis) || 0) + playtime * share);
        }
      }
    }
    if (mappedPlaytime > 0) {
      const weight = totalWeight * SHARES.genres;
      for (const [axis, value] of axisPlaytime) {
        contributions.push({
          axis,
          value: clamp01(value / mappedPlaytime),
          weight: weight * (value / mappedPlaytime),
          source: source('genres'),
        });
      }
    }
  }

  return {
    contributions,
    meta: {
      stale,
      ageDays: ageDays === null ? null : Number(ageDays.toFixed(1)),
      backlogRate,
      completionConfidencePenalty: backlogRate >= BACKLOG_CONFIDENCE_PENALTY_RATE,
      gameCount: games.length,
    },
  };
}

module.exports = {
  BACKLOG_CONFIDENCE_PENALTY_RATE,
  STALE_AFTER_DAYS,
  TOTAL_WEIGHT,
  steamContributions,
};
