const db = require('../../config/database');
const { AppError } = require('../../middleware/errorHandler');

class CernereUserResolver {
  constructor(database = db) {
    this.database = database;
  }

  async resolve(localUserId) {
    const { rows } = await this.database.query(
      `SELECT provider_sub
       FROM federated_identities
       WHERE user_id = $1 AND provider = 'cernere'
       LIMIT 1`,
      [localUserId]
    );
    if (!rows[0]?.provider_sub) {
      throw new AppError(
        409,
        'CERNERE_IDENTITY_REQUIRED',
        'Sign in with Cernere before using online profile data'
      );
    }
    return rows[0].provider_sub;
  }
}

module.exports = { CernereUserResolver };
