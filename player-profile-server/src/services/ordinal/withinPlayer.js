// Within-player ordinal normalization (spec/feature/game-experience-scales.md
// §順序化). Self-reported emotion is reliable as an order ("higher than
// before") and unreliable as an absolute ("a 4") — Yannakakis, Cowie & Busso,
// "The Ordinal Nature of Emotions" (2017). So before any cross-player average
// every player's raw values are re-expressed against that player's own
// distribution: a z-score (how far above their usual) and a percentile rank
// (what share of their own records sit below). A loud recorder who always
// answers 2 and a quiet one who always answers 0 then weigh the same.
//
// Pure functions; null/non-finite inputs are kept as null so coverage stays
// visible downstream.

function finite(values) {
  return values.filter((value) => Number.isFinite(value));
}

function mean(values) {
  const xs = finite(values);
  return xs.length === 0 ? null : xs.reduce((sum, value) => sum + value, 0) / xs.length;
}

function standardDeviation(values, center) {
  const xs = finite(values);
  if (xs.length === 0 || center === null) return null;
  return Math.sqrt(xs.reduce((sum, value) => sum + (value - center) ** 2, 0) / xs.length);
}

// A player's own baseline: `{ mean, sd, count }` over the finite values.
/** @implements SPEC-GAME-EXPERIENCE-SCALES */
function baseline(values) {
  const center = mean(values);
  return { mean: center, sd: standardDeviation(values, center), count: finite(values).length };
}

// z against a baseline; a flat recorder (sd 0) or a single record is 0
// everywhere — "no deviation from their usual", not "unknown".
/** @implements SPEC-GAME-EXPERIENCE-SCALES */
function zScore(value, base) {
  if (!Number.isFinite(value) || base.mean === null) return null;
  if (!base.sd) return 0;
  return (value - base.mean) / base.sd;
}

// Mid-rank percentile in 0..1 of `value` among `population` (ties share the
// average rank); a single record is 0.5.
/** @implements SPEC-GAME-EXPERIENCE-SCALES */
function percentileRank(value, population) {
  const xs = finite(population);
  if (!Number.isFinite(value) || xs.length === 0) return null;
  if (xs.length === 1) return 0.5;
  let below = 0;
  let equal = 0;
  for (const other of xs) {
    if (other < value) below += 1;
    else if (other === value) equal += 1;
  }
  return (below + (equal - 1) / 2) / (xs.length - 1);
}

// Re-express `values` (one player's series; nulls allowed) against that
// player's own distribution. `pool` lets the caller widen the baseline beyond
// this series (e.g. all of the player's sessions) so each session is scored
// against the player, not against itself.
/** @implements SPEC-GAME-EXPERIENCE-SCALES */
function normalizeWithinPlayer(values, pool = values) {
  const base = baseline(pool);
  return {
    baseline: base,
    z: values.map((value) => zScore(value, base)),
    rank: values.map((value) => percentileRank(value, pool)),
  };
}

module.exports = { baseline, normalizeWithinPlayer, percentileRank, zScore };
