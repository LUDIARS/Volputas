const AI_PENDING = `
  SELECT r.id, r.run_id, r.game_id, r.game_title, r.summary, r.good, r.bad, r.confusions,
         r.played_at, r.created_at
  FROM ai_playtest_reviews r
  LEFT JOIN cc_management_event_delivery d ON d.origin = 'ai' AND d.source_id = r.id
  WHERE d.state IS NULL OR d.state = 'pending'
  ORDER BY d.attempted_at NULLS FIRST, r.created_at, r.id
  LIMIT $1`;

const HUMAN_PENDING = `
  SELECT i.id, s.game_id, i.captured_at, i.created_at
  FROM play_impressions i
  JOIN play_sessions s ON s.id = i.session_id
  LEFT JOIN cc_management_event_delivery d ON d.origin = 'human' AND d.source_id = i.id::text
  WHERE i.status = 'ready' AND i.deleted_at IS NULL AND (d.state IS NULL OR d.state = 'pending')
  ORDER BY d.attempted_at NULLS FIRST, i.created_at, i.id
  LIMIT $1`;

/** @implements SPEC-VO-CC-MANAGEMENT-EVENTS */
function createManagementEventDeliveryRepository(database) {
  return {
    async listPendingAi(limit) {
      const { rows } = await database.query(AI_PENDING, [limit]);
      return rows;
    },
    async listPendingHuman(limit) {
      const { rows } = await database.query(HUMAN_PENDING, [limit]);
      return rows;
    },
    async recordAttempt(origin, sourceId, { state, status }) {
      await database.query(
        `INSERT INTO cc_management_event_delivery (origin, source_id, state, http_status)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (origin, source_id) DO UPDATE
         SET state = EXCLUDED.state, http_status = EXCLUDED.http_status, attempted_at = now()
         WHERE cc_management_event_delivery.state = 'pending'`,
        [origin, sourceId, state, status],
      );
    },
  };
}

module.exports = { createManagementEventDeliveryRepository };
