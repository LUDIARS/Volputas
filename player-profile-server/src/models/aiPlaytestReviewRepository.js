// オンラインモードの AI プレイテスト感想の保存先 (Voluptas 自身の DB、migration 018)。
// 人の書き手を持たない記録なので user_id 列は無い。run_id は一意で、再送は既存の行を返す。
const db = require('../config/database');

function mapReview(row) {
  return {
    id: row.id,
    format: row.format,
    source: row.source,
    gameId: row.game_id,
    gameTitle: row.game_title,
    runId: row.run_id,
    persona: row.persona,
    engineVersion: row.engine_version,
    adapter: row.adapter,
    screen: row.screen,
    ticks: Number(row.ticks),
    turns: Number(row.turns),
    outcome: row.outcome,
    summary: row.summary,
    good: row.good,
    bad: row.bad,
    confusions: row.confusions,
    reflection: row.reflection,
    playedAt: new Date(row.played_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/** @implements SPEC-VO-AI-PLAYTEST-REVIEWS */
function createAiPlaytestReviewRepository(database = db) {
  return {
    async save(record) {
      const { rows } = await database.query(
        `INSERT INTO ai_playtest_reviews
          (id, format, source, game_id, game_title, run_id, persona, engine_version, adapter, screen,
           ticks, turns, outcome, summary, good, bad, confusions, reflection, played_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16::jsonb, $17::jsonb, $18::jsonb, $19, $20)
         ON CONFLICT (run_id) DO NOTHING
         RETURNING *`,
        [
          record.id, record.format, record.source, record.gameId, record.gameTitle, record.runId, record.persona,
          record.engineVersion, record.adapter, record.screen, record.ticks, record.turns, record.outcome, record.summary,
          JSON.stringify(record.good), JSON.stringify(record.bad), JSON.stringify(record.confusions),
          JSON.stringify(record.reflection), record.playedAt, record.createdAt,
        ],
      );
      if (rows[0]) return { record: mapReview(rows[0]), created: true };
      const existing = await database.query('SELECT * FROM ai_playtest_reviews WHERE run_id = $1', [record.runId]);
      return { record: mapReview(existing.rows[0]), created: false };
    },

    async list({ limit }) {
      const { rows } = await database.query('SELECT * FROM ai_playtest_reviews ORDER BY created_at DESC, id LIMIT $1', [limit]);
      return rows.map(mapReview);
    },
  };
}

module.exports = { createAiPlaytestReviewRepository };
