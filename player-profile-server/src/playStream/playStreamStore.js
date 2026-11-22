// プレイ記録の保存 (SPEC-VO-PLAY-STREAM-STORE)。既存の play_sessions / play_events をそのまま使う。
// - セッションの id はクライアントが作る UUID (つなぎ直して session_start を送り直しても 1 行のまま)
// - 記録の重複は event_data.seq で判定する (1 接続のフレームは順に処理するので、確認してから書けば足りる)
// - 集計は ludellus.session_summary の記録として同じ表に置く

const { SESSION_SUMMARY_EVENT_TYPE } = require('../services/trialResult');

function createPlayStreamStore(database) {
  return {
    /** @returns {Promise<'created' | 'duplicate'>} */
    async createSession({ id, userId, playerId = null, gameId, startedAt, metadata }) {
      const { rows } = await database.query(
        `INSERT INTO play_sessions (id, user_id, ludellus_player_id, game_id, started_at, metadata)
         VALUES ($1, $2, $6, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        [id, userId, gameId, startedAt, JSON.stringify({ ...metadata, source: 'ludellus.play_stream' }), playerId],
      );
      return rows.length > 0 ? 'created' : 'duplicate';
    },

    async findSession(id) {
      const { rows } = await database.query(
        'SELECT id, user_id, ludellus_player_id, game_id, started_at, ended_at, metadata FROM play_sessions WHERE id = $1',
        [id],
      );
      return rows[0] || null;
    },

    async hasEvent(sessionId, seq) {
      const { rows } = await database.query(
        `SELECT 1 FROM play_events
          WHERE session_id = $1 AND event_data->>'seq' = $2
          LIMIT 1`,
        [sessionId, String(seq)],
      );
      return rows.length > 0;
    },

    async countEvents(sessionId) {
      const { rows } = await database.query(
        'SELECT count(*)::int AS n FROM play_events WHERE session_id = $1',
        [sessionId],
      );
      return rows[0]?.n ?? 0;
    },

    async insertEvent({ sessionId, eventType, eventData }) {
      await database.query(
        `INSERT INTO play_events (session_id, event_type, event_data, occurred_at)
         VALUES ($1, $2, $3, now())`,
        [sessionId, eventType, JSON.stringify(eventData)],
      );
    },

    async listEvents(sessionId) {
      const { rows } = await database.query(
        `SELECT event_type, event_data FROM play_events
          WHERE session_id = $1
          ORDER BY id ASC`,
        [sessionId],
      );
      return rows;
    },

    /** 終了時刻と集計を 1 つの単位で書く。既に終わっていれば null。 */
    async endSession({ id, userId, endedAt, summary }) {
      return database.transaction(async (client) => {
        const { rows } = await client.query(
          `UPDATE play_sessions SET ended_at = $3
            WHERE id = $1 AND user_id = $2 AND ended_at IS NULL
            RETURNING *`,
          [id, userId, endedAt],
        );
        if (!rows[0]) return null;
        await client.query(
          `INSERT INTO play_events (session_id, event_type, event_data, occurred_at)
           VALUES ($1, $2, $3, $4)`,
          [id, SESSION_SUMMARY_EVENT_TYPE, JSON.stringify(summary), endedAt],
        );
        return rows[0];
      });
    },

    /** 統計用: その人の終わったセッションと集計を新しい順に。gameId / playerId を渡せばそのゲーム・その子だけ。 */
    async listSummaries({ userId, gameId = null, playerId = null, limit = 200 }) {
      const { rows } = await database.query(
        `SELECT s.id, s.game_id, s.ludellus_player_id, s.started_at, s.ended_at, e.event_data AS summary
           FROM play_sessions s
           JOIN play_events e ON e.session_id = s.id AND e.event_type = $2
          WHERE s.user_id = $1 AND ($3::text IS NULL OR s.game_id = $3)
            AND ($5::text IS NULL OR s.ludellus_player_id = $5)
          ORDER BY s.ended_at DESC
          LIMIT $4`,
        [userId, SESSION_SUMMARY_EVENT_TYPE, gameId, limit, playerId],
      );
      return rows;
    },
  };
}

module.exports = { createPlayStreamStore };
