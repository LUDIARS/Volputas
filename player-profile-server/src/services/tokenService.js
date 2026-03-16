const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const db = require('../config/database');
const { getCurrentSigningKey } = require('./jwks');

async function issueTokens(userId) {
  const { privateKey, kid } = await getCurrentSigningKey();
  const jti = uuidv4();

  const accessToken = jwt.sign(
    { sub: userId, jti },
    privateKey,
    {
      algorithm: 'RS256',
      expiresIn: config.jwt.accessTokenExpiresIn,
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
      keyid: kid,
    }
  );

  const refreshToken = crypto.randomBytes(48).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + config.jwt.refreshTokenExpiresInDays);

  await db.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt]
  );

  return { accessToken, refreshToken };
}

async function refreshAccessToken(refreshToken) {
  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

  const { rows } = await db.query(
    `SELECT id, user_id, expires_at, revoked_at
     FROM refresh_tokens
     WHERE token_hash = $1`,
    [tokenHash]
  );

  if (rows.length === 0) {
    throw Object.assign(new Error('Invalid refresh token'), { statusCode: 401, code: 'INVALID_TOKEN' });
  }

  const row = rows[0];
  if (row.revoked_at || new Date(row.expires_at) < new Date()) {
    throw Object.assign(new Error('Refresh token expired or revoked'), { statusCode: 401, code: 'TOKEN_EXPIRED' });
  }

  // Rotate: revoke old, issue new
  await db.query(
    'UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1',
    [row.id]
  );

  return issueTokens(row.user_id);
}

async function revokeAllTokens(userId) {
  await db.query(
    'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
    [userId]
  );
}

module.exports = { issueTokens, refreshAccessToken, revokeAllTokens };
