const db = require('../config/database');

const profileModel = {
  async findByUserId(userId) {
    const { rows } = await db.query(
      `SELECT user_id, playstyle_tags, personality_data, preference_vector,
              preference_version, updated_at
       FROM player_profiles WHERE user_id = $1`,
      [userId]
    );
    return rows[0] || null;
  },

  async upsert(userId, fields) {
    const { rows } = await db.query(
      `INSERT INTO player_profiles (user_id, playstyle_tags, personality_data, preference_vector)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id)
       DO UPDATE SET
         playstyle_tags = COALESCE($2, player_profiles.playstyle_tags),
         personality_data = COALESCE($3, player_profiles.personality_data),
         preference_vector = COALESCE($4, player_profiles.preference_vector)
       RETURNING *`,
      [
        userId,
        fields.playstyleTags || null,
        fields.personalityData ? JSON.stringify(fields.personalityData) : null,
        fields.preferenceVector || null,
      ]
    );
    return rows[0];
  },

  async updatePreferenceVector(userId, vector, tags) {
    const { rows } = await db.query(
      `UPDATE player_profiles
       SET preference_vector = $2,
           playstyle_tags = $3,
           preference_version = preference_version + 1
       WHERE user_id = $1
       RETURNING *`,
      [userId, vector, tags]
    );
    return rows[0] || null;
  },
};

module.exports = profileModel;
