const db = require('../config/database');

const identityModel = {
  async findByProviderSub(provider, providerSub) {
    const { rows } = await db.query(
      'SELECT * FROM federated_identities WHERE provider = $1 AND provider_sub = $2',
      [provider, providerSub]
    );
    return rows[0] || null;
  },

  async findByUserId(userId) {
    const { rows } = await db.query(
      'SELECT id, provider, provider_sub, email, linked_at FROM federated_identities WHERE user_id = $1',
      [userId]
    );
    return rows;
  },

  async create({ userId, provider, providerSub, email, rawProfile }) {
    const { rows } = await db.query(
      `INSERT INTO federated_identities (user_id, provider, provider_sub, email, raw_profile)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, user_id, provider, provider_sub, email, linked_at`,
      [userId, provider, providerSub, email || null, rawProfile ? JSON.stringify(rawProfile) : null]
    );
    return rows[0];
  },

  async deleteByProvider(userId, provider) {
    const { rowCount } = await db.query(
      'DELETE FROM federated_identities WHERE user_id = $1 AND provider = $2',
      [userId, provider]
    );
    return rowCount > 0;
  },

  async countByUserId(userId) {
    const { rows } = await db.query(
      'SELECT COUNT(*) AS count FROM federated_identities WHERE user_id = $1',
      [userId]
    );
    return parseInt(rows[0].count, 10);
  },
};

module.exports = identityModel;
