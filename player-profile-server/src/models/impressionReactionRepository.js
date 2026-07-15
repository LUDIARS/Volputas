const db = require('../config/database');

function mapReaction(row) {
  return {
    id: row.id,
    impression_id: row.impression_id,
    video_offset_ms: Number(row.video_offset_ms),
    kind: row.kind,
    content: row.content,
    recorded_at: row.recorded_at,
    created_at: row.created_at,
  };
}

function createImpressionReactionRepository(database = db) {
  return {
    async getVideoContext(impressionId, userId) {
      const { rows } = await database.query(
        `SELECT pi.id, pi.status AS impression_status, pi.capture_anchor_id, pi.captured_at,
                ps.game_id, ia.status AS asset_status, ia.duration_ms, ia.sha256,
                ia.mime_type, ia.clip_started_at, ia.clip_ended_at
         FROM play_impressions pi
         JOIN play_sessions ps ON ps.id = pi.session_id
         LEFT JOIN impression_assets ia
           ON ia.impression_id = pi.id AND ia.kind = 'video'
         WHERE pi.id = $1 AND pi.user_id = $2 AND pi.deleted_at IS NULL`,
        [impressionId, userId]
      );
      if (!rows[0]) return null;
      return {
        impressionId: rows[0].id,
        impressionStatus: rows[0].impression_status,
        assetStatus: rows[0].asset_status,
        durationMs: rows[0].duration_ms === null ? null : Number(rows[0].duration_ms),
        captureAnchorId: rows[0].capture_anchor_id,
        capturedAt: rows[0].captured_at,
        gameId: rows[0].game_id,
        videoSha256: rows[0].sha256,
        videoMimeType: rows[0].mime_type,
        clipStartedAt: rows[0].clip_started_at,
        clipEndedAt: rows[0].clip_ended_at,
      };
    },

    async listOwned(impressionId, userId) {
      const { rows } = await database.query(
        `SELECT ir.*
         FROM impression_reactions ir
         JOIN play_impressions pi ON pi.id = ir.impression_id
         WHERE ir.impression_id = $1 AND pi.user_id = $2 AND pi.deleted_at IS NULL
         ORDER BY ir.video_offset_ms, ir.created_at`,
        [impressionId, userId]
      );
      return rows.map(mapReaction);
    },

    async create(input) {
      const { rows } = await database.query(
        `INSERT INTO impression_reactions (
           id, impression_id, video_offset_ms, kind, content, recorded_at
         ) VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          input.id,
          input.impressionId,
          input.videoOffsetMs,
          input.kind,
          input.content,
          input.recordedAt,
        ]
      );
      return mapReaction(rows[0]);
    },

    async removeOwned(reactionId, impressionId, userId) {
      const { rows } = await database.query(
        `DELETE FROM impression_reactions ir
         USING play_impressions pi
         WHERE ir.id = $1 AND ir.impression_id = $2
           AND pi.id = ir.impression_id AND pi.user_id = $3 AND pi.deleted_at IS NULL
         RETURNING ir.id`,
        [reactionId, impressionId, userId]
      );
      return Boolean(rows[0]);
    },
  };
}

module.exports = createImpressionReactionRepository();
module.exports.createImpressionReactionRepository = createImpressionReactionRepository;
