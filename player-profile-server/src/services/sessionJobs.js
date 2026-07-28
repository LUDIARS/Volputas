// Post-session async jobs (ludellus-tuning-log-design.md §12).
// On session end the design triggers the ability-estimation job alongside the
// existing analysisEngine job. Here that means: recompute the player's ability
// snapshot for the game, and fold the session's trials into content_items.stats.
//
// Best-effort by contract: this never throws. Session-end must not fail because a
// derived-metrics job hit an error, and errors must not surface as unhandled
// rejections when the caller fires this without awaiting. Each job is isolated so
// one failing does not skip the other.

const { computeAbilitySnapshot } = require('./abilityEngine');
const { updateContentStatsForSession } = require('./contentCalibration');

async function runPostSessionJobs(session, options = {}) {
  const result = { ability: null, contentStats: null, errors: [] };
  if (!session || !session.id || !session.user_id || !session.game_id) {
    result.errors.push('invalid session');
    return result;
  }
  const opts = { database: options.database, now: options.now };

  try {
    result.ability = await computeAbilitySnapshot(session.user_id, session.game_id, opts);
  } catch (err) {
    result.errors.push(`ability: ${err.message}`);
    console.error('runPostSessionJobs: ability snapshot failed', err);
  }

  try {
    result.contentStats = await updateContentStatsForSession(session.id, opts);
  } catch (err) {
    result.errors.push(`contentStats: ${err.message}`);
    console.error('runPostSessionJobs: content stats failed', err);
  }

  return result;
}

module.exports = { runPostSessionJobs };
