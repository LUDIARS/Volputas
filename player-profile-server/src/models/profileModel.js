const db = require('../config/database');

const profileModel = {
  async findByUserId(userId) {
    const { rows } = await db.query(
      `SELECT user_id, playstyle_tags, personality_data, preference_vector,
              classification_data, subtype_data,
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

  async updatePreferenceVector(userId, vector, tags, classification, subtypes) {
    const { rows } = await db.query(
      `UPDATE player_profiles
       SET preference_vector = $2,
           playstyle_tags = $3,
           classification_data = $4,
           subtype_data = $5,
           preference_version = preference_version + 1
       WHERE user_id = $1
       RETURNING *`,
      [
        userId,
        vector,
        tags,
        classification ? JSON.stringify(classification) : null,
        subtypes ? JSON.stringify(subtypes) : null,
      ]
    );
    return rows[0] || null;
  },

  // 本人が承認したMemoria由来の性格軸を personality_data にマージする。
  // 既存の personality_data (例: 本人が手入力したMBTI等) は消さず、memoria_axes キーだけ
  // 置き換える (COALESCE + jsonb || で読み-書きの競合なくアトミックにマージ)。
  async mergePersonalityAxes(userId, axes) {
    const { rows } = await db.query(
      `INSERT INTO player_profiles (user_id, personality_data)
       VALUES ($1, jsonb_build_object('memoria_axes', $2::jsonb, 'memoria_axes_updated_at', now()))
       ON CONFLICT (user_id) DO UPDATE SET
         personality_data = COALESCE(player_profiles.personality_data, '{}'::jsonb)
           || jsonb_build_object('memoria_axes', $2::jsonb, 'memoria_axes_updated_at', now())
       RETURNING *`,
      [userId, JSON.stringify(axes)]
    );
    return rows[0];
  },
};

module.exports = profileModel;
