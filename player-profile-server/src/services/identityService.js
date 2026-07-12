const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const { pickProfileFields } = require('./profileFields');

async function findOrCreateUser(provider, providerSub, profile, rawProfile = {}, database = db) {
  try {
    return await database.transaction(async (client) => {
      const existing = await client.query(
        'SELECT user_id FROM federated_identities WHERE provider = $1 AND provider_sub = $2',
        [provider, providerSub]
      );
      if (existing.rows[0]) return existing.rows[0].user_id;

      const userId = uuidv4();
      await client.query(
        `INSERT INTO users (id, display_name, avatar_url, locale)
         VALUES ($1, $2, $3, $4)`,
        [userId, profile.displayName || 'Player', profile.avatarUrl || null, profile.locale || 'ja']
      );
      await client.query(
        `INSERT INTO federated_identities (user_id, provider, provider_sub, email, raw_profile)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          userId,
          provider,
          providerSub,
          profile.email || null,
          JSON.stringify(pickProfileFields(provider, rawProfile)),
        ]
      );
      return userId;
    });
  } catch (error) {
    if (error.code !== '23505') throw error;
    const { rows } = await database.query(
      'SELECT user_id FROM federated_identities WHERE provider = $1 AND provider_sub = $2',
      [provider, providerSub]
    );
    if (rows[0]) return rows[0].user_id;
    throw error;
  }
}

module.exports = { findOrCreateUser };
