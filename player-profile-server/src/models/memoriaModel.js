const db = require('../config/database');

const memoriaModel = {
  async getLink(userId) {
    const { rows } = await db.query(
      `SELECT user_id, memoria_base_url, token_ciphertext, linked_at, last_synced_at
       FROM memoria_links WHERE user_id = $1`,
      [userId]
    );
    return rows[0] || null;
  },

  async upsertLink(userId, { baseUrl, tokenCiphertext }) {
    const { rows } = await db.query(
      `INSERT INTO memoria_links (user_id, memoria_base_url, token_ciphertext)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET
         memoria_base_url = $2,
         token_ciphertext = $3,
         linked_at = now()
       RETURNING user_id, memoria_base_url, linked_at, last_synced_at`,
      [userId, baseUrl, tokenCiphertext]
    );
    return rows[0];
  },

  async touchSync(userId) {
    await db.query('UPDATE memoria_links SET last_synced_at = now() WHERE user_id = $1', [userId]);
  },

  async deleteLink(userId) {
    const { rowCount } = await db.query('DELETE FROM memoria_links WHERE user_id = $1', [userId]);
    return rowCount > 0;
  },

  async createDraft(userId, { axes, computedAt }) {
    const { rows } = await db.query(
      `INSERT INTO personality_drafts (user_id, axes, computed_at)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [userId, JSON.stringify(axes), computedAt]
    );
    return rows[0];
  },

  async getLatestDraft(userId) {
    const { rows } = await db.query(
      `SELECT * FROM personality_drafts WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    return rows[0] || null;
  },

  async getPendingDraftForUser(id, userId) {
    const { rows } = await db.query(
      `SELECT * FROM personality_drafts WHERE id = $1 AND user_id = $2 AND status = 'pending'`,
      [id, userId]
    );
    return rows[0] || null;
  },

  async setDraftStatus(id, userId, status) {
    const { rows } = await db.query(
      `UPDATE personality_drafts
       SET status = $3, reviewed_at = now()
       WHERE id = $1 AND user_id = $2 AND status = 'pending'
       RETURNING *`,
      [id, userId, status]
    );
    return rows[0] || null;
  },
};

module.exports = memoriaModel;
