const jwt = require('jsonwebtoken');
const config = require('../config');
const { getCurrentSigningKey, getSigningKey } = require('./jwks');

const MEDIA_AUDIENCE = `${config.jwt.audience}:profile-media`;

async function issueMediaTicket({ userId, kind, recordId }) {
  const { privateKey, kid } = await getCurrentSigningKey();
  return jwt.sign(
    { sub: userId, kind, recordId },
    privateKey,
    {
      algorithm: 'RS256',
      expiresIn: '10m',
      issuer: config.jwt.issuer,
      audience: MEDIA_AUDIENCE,
      keyid: kid,
    }
  );
}

async function verifyMediaTicket(token) {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded) throw Object.assign(new Error('Invalid media ticket'), { code: 'INVALID_MEDIA_TICKET' });
  const { publicKey } = await getSigningKey(decoded.header.kid);
  return jwt.verify(token, publicKey, {
    algorithms: ['RS256'],
    issuer: config.jwt.issuer,
    audience: MEDIA_AUDIENCE,
  });
}

module.exports = { issueMediaTicket, verifyMediaTicket };
