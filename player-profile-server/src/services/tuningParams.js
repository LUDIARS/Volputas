const db = require('../config/database');

/**
 * Shape a raw player_tuning_params row into a camelCase API view.
 * Pure function — deterministic, no DB access — so it is unit-testable in
 * isolation (mirrors glabSurveyService's surveyView / validateAnswers split).
 */
function tuningParamsView(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    gameId: row.game_id,
    tuningVersion: row.tuning_version,
    params: row.params ?? {},
    basedOnSnapshot: row.based_on_snapshot ?? null,
    computedAt: row.computed_at,
  };
}

/**
 * Read the current tuning parameters for a user + game.
 * Returns the view, or null when no row exists.
 * `database` is injectable for tests (same pattern as affectTimeline.js).
 */
async function getTuningParams(userId, gameId, database = db) {
  const { rows } = await database.query(
    `SELECT user_id, game_id, tuning_version, params, based_on_snapshot, computed_at
       FROM player_tuning_params
      WHERE user_id = $1 AND game_id = $2`,
    [userId, gameId]
  );
  return tuningParamsView(rows[0] || null);
}

module.exports = {
  getTuningParams,
  tuningParamsView,
};
