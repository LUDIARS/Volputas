const db = require('../config/database');

const sessionModel = {
  async create({ userId, gameId, metadata }) {
    const { rows } = await db.query(
      `INSERT INTO play_sessions (user_id, game_id, metadata)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [userId, gameId, metadata ? JSON.stringify(metadata) : null]
    );
    return rows[0];
  },

  async endSession(id, userId) {
    const { rows } = await db.query(
      `UPDATE play_sessions SET ended_at = now()
       WHERE id = $1 AND user_id = $2 AND ended_at IS NULL
       RETURNING *`,
      [id, userId]
    );
    return rows[0] || null;
  },

  async heartbeat(id, userId, { elapsedMs, activeMs, occurredAt }) {
    const { rows } = await db.query(
      `UPDATE play_sessions
       SET last_heartbeat_at = GREATEST(COALESCE(last_heartbeat_at, started_at), $5::timestamptz),
           elapsed_ms = GREATEST(elapsed_ms, $3),
           active_ms = GREATEST(active_ms, LEAST($4, $3))
       WHERE id = $1 AND user_id = $2 AND ended_at IS NULL
       RETURNING *`,
      [id, userId, elapsedMs, activeMs, occurredAt]
    );
    return rows[0] || null;
  },

  async closeStale(staleHours) {
    const { rows } = await db.query(
      `UPDATE play_sessions
       SET ended_at = GREATEST(started_at, COALESCE(last_heartbeat_at, started_at))
       WHERE ended_at IS NULL
         AND COALESCE(last_heartbeat_at, started_at) < now() - ($1 * interval '1 hour')
       RETURNING id`,
      [staleHours]
    );
    return rows.length;
  },

  async findById(id) {
    const { rows } = await db.query(
      'SELECT * FROM play_sessions WHERE id = $1',
      [id]
    );
    return rows[0] || null;
  },

  async findByUserId(userId, { limit = 20, offset = 0 } = {}) {
    const { rows } = await db.query(
      `SELECT * FROM play_sessions
       WHERE user_id = $1
       ORDER BY started_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    const { rows: countRows } = await db.query(
      'SELECT COUNT(*) AS total FROM play_sessions WHERE user_id = $1',
      [userId]
    );

    return { sessions: rows, total: parseInt(countRows[0].total, 10) };
  },
};

module.exports = sessionModel;
