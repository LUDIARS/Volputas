const db = require('../config/database');

const steamModel = {
  async getProfile(userId) {
    const { rows } = await db.query(
      `SELECT user_id, steam_id64, persona_name, avatar_url, profile_url,
              visibility_state, linked_at, last_synced_at
       FROM steam_profiles WHERE user_id = $1`,
      [userId]
    );
    return rows[0] || null;
  },

  async findByProviderSteamId(steamId64) {
    const { rows } = await db.query(
      'SELECT user_id FROM steam_profiles WHERE steam_id64 = $1',
      [steamId64]
    );
    return rows[0] || null;
  },

  async upsertProfile(userId, profile) {
    const { rows } = await db.query(
      `INSERT INTO steam_profiles (user_id, steam_id64, persona_name, avatar_url, profile_url, visibility_state)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) DO UPDATE SET
         steam_id64 = $2,
         persona_name = $3,
         avatar_url = $4,
         profile_url = $5,
         visibility_state = $6
       RETURNING *`,
      [userId, profile.steamId64, profile.personaName, profile.avatarUrl, profile.profileUrl, profile.visibilityState]
    );
    return rows[0];
  },

  async replaceOwnedGames(userId, games, database = db) {
    await database.transaction(async (client) => {
      await client.query('DELETE FROM steam_owned_games WHERE user_id = $1', [userId]);
      for (const game of games) {
        await client.query(
          `INSERT INTO steam_owned_games
             (user_id, app_id, name, playtime_forever_minutes, playtime_2weeks_minutes, img_icon_url)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [userId, game.appId, game.name, game.playtimeForeverMinutes, game.playtime2WeeksMinutes, game.imgIconUrl]
        );
      }
      await client.query(
        'UPDATE steam_profiles SET last_synced_at = now() WHERE user_id = $1',
        [userId]
      );
    });
  },

  async getTopGamesByPlaytime(userId, limit = 10) {
    const { rows } = await db.query(
      `SELECT app_id, name, playtime_forever_minutes, playtime_2weeks_minutes, img_icon_url
       FROM steam_owned_games
       WHERE user_id = $1
       ORDER BY playtime_forever_minutes DESC
       LIMIT $2`,
      [userId, limit]
    );
    return rows;
  },

  async deleteByUserId(userId) {
    await db.transaction(async (client) => {
      await client.query('DELETE FROM steam_owned_games WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM steam_profiles WHERE user_id = $1', [userId]);
    });
  },
};

module.exports = steamModel;
