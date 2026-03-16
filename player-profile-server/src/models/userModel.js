const db = require('../config/database');

const userModel = {
  async findById(id) {
    const { rows } = await db.query(
      'SELECT id, display_name, avatar_url, locale, created_at, updated_at FROM users WHERE id = $1 AND is_deleted = false',
      [id]
    );
    return rows[0] || null;
  },

  async create({ id, displayName, avatarUrl, locale }) {
    const { rows } = await db.query(
      `INSERT INTO users (id, display_name, avatar_url, locale)
       VALUES ($1, $2, $3, $4)
       RETURNING id, display_name, avatar_url, locale, created_at, updated_at`,
      [id, displayName, avatarUrl || null, locale || 'ja']
    );
    return rows[0];
  },

  async update(id, fields) {
    const sets = [];
    const values = [];
    let idx = 1;

    if (fields.displayName !== undefined) {
      sets.push(`display_name = $${idx++}`);
      values.push(fields.displayName);
    }
    if (fields.avatarUrl !== undefined) {
      sets.push(`avatar_url = $${idx++}`);
      values.push(fields.avatarUrl);
    }
    if (fields.locale !== undefined) {
      sets.push(`locale = $${idx++}`);
      values.push(fields.locale);
    }

    if (sets.length === 0) return this.findById(id);

    values.push(id);
    const { rows } = await db.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${idx} AND is_deleted = false
       RETURNING id, display_name, avatar_url, locale, created_at, updated_at`,
      values
    );
    return rows[0] || null;
  },

  async softDelete(id) {
    const { rowCount } = await db.query(
      'UPDATE users SET is_deleted = true WHERE id = $1 AND is_deleted = false',
      [id]
    );
    return rowCount > 0;
  },
};

module.exports = userModel;
