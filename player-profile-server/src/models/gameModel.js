const db = require('../config/database');

const COLUMNS = `id, title, team, platform, description, store_url,
                 glab_project_id, is_active, created_at, updated_at`;

// 部分更新を 1 本の UPDATE にまとめる。 入力キーは gameContract が検証済みの
// ホワイトリストなので、 ここで列名を組み立てても任意列には届かない。
const UPDATABLE_COLUMNS = Object.freeze({
  title: 'title',
  team: 'team',
  platform: 'platform',
  description: 'description',
  storeUrl: 'store_url',
  glabProjectId: 'glab_project_id',
  isActive: 'is_active',
});

const gameModel = {
  async list({ includeInactive = false } = {}) {
    const { rows } = await db.query(
      `SELECT ${COLUMNS} FROM games
       ${includeInactive ? '' : 'WHERE is_active = true'}
       ORDER BY is_active DESC, title ASC`,
    );
    return rows;
  },

  async findById(id) {
    const { rows } = await db.query(`SELECT ${COLUMNS} FROM games WHERE id = $1`, [id]);
    return rows[0] || null;
  },

  async create(input, registeredBy) {
    const { rows } = await db.query(
      `INSERT INTO games (title, team, platform, description, store_url,
                          glab_project_id, is_active, registered_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${COLUMNS}`,
      [
        input.title,
        input.team,
        input.platform,
        input.description,
        input.storeUrl,
        input.glabProjectId,
        input.isActive,
        registeredBy,
      ],
    );
    return rows[0];
  },

  async update(id, patch) {
    const assignments = [];
    const values = [];
    for (const [key, column] of Object.entries(UPDATABLE_COLUMNS)) {
      if (!Object.hasOwn(patch, key)) continue;
      values.push(patch[key]);
      assignments.push(`${column} = $${values.length}`);
    }
    if (assignments.length === 0) return this.findById(id);
    values.push(id);
    const { rows } = await db.query(
      `UPDATE games SET ${assignments.join(', ')}, updated_at = now()
       WHERE id = $${values.length}
       RETURNING ${COLUMNS}`,
      values,
    );
    return rows[0] || null;
  },
};

module.exports = gameModel;
