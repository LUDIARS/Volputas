const jwt = require('jsonwebtoken');
const config = require('../config');
const { getCurrentSigningKey, getSigningKey } = require('./jwks');

const MEDIA_AUDIENCE = `${config.jwt.audience}:profile-media`;

// sub が何の id かを券面に書く。 自前フロント経由の券は Volputas ローカルの
// user id、 GLAB 経由の券は Cernere の owner id で、 同じ値空間ではない。
// 明示しないと、 片方の券をもう片方の再生口で使われたときに「別人の id を
// 所有者として解決する」 事故になる。
const LOCAL_SUBJECT = 'local-user';
const OWNER_SUBJECT = 'cernere-owner';

function invalidMediaTicket() {
  return Object.assign(new Error('Invalid media ticket'), { code: 'INVALID_MEDIA_TICKET' });
}

/** @implements SPEC-GLAB-EVIDENCE-MEDIA-TICKET */
async function issueMediaTicket({ userId, kind, recordId, subjectType = LOCAL_SUBJECT }) {
  const { privateKey, kid } = await getCurrentSigningKey();
  return jwt.sign(
    { sub: userId, kind, recordId, subjectType },
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

/** @implements SPEC-GLAB-EVIDENCE-MEDIA-TICKET */
async function verifyMediaTicket(token, { subjectType = LOCAL_SUBJECT } = {}) {
  if (typeof token !== 'string') throw invalidMediaTicket();
  const decoded = jwt.decode(token, { complete: true });
  if (
    !decoded
    || decoded.header?.alg !== 'RS256'
    || typeof decoded.header?.kid !== 'string'
    || !decoded.header.kid
  ) {
    throw invalidMediaTicket();
  }
  let publicKey;
  try {
    ({ publicKey } = await getSigningKey(decoded.header.kid));
  } catch (error) {
    // The kid is attacker-controlled. An unknown key is an invalid credential,
    // not an internal server failure; retain genuine key-store failures.
    if (error?.message === 'Signing key not found') throw invalidMediaTicket();
    throw error;
  }
  const claims = jwt.verify(token, publicKey, {
    algorithms: ['RS256'],
    issuer: config.jwt.issuer,
    audience: MEDIA_AUDIENCE,
  });
  // subjectType を持たない券は GLAB 経路より前に発行されたローカル券。
  if ((claims.subjectType || LOCAL_SUBJECT) !== subjectType) {
    throw invalidMediaTicket();
  }
  if (
    typeof claims.sub !== 'string'
    || !claims.sub
    || typeof claims.kind !== 'string'
    || !claims.kind
    || typeof claims.recordId !== 'string'
    || !claims.recordId
  ) {
    throw invalidMediaTicket();
  }
  return claims;
}

module.exports = {
  LOCAL_SUBJECT,
  OWNER_SUBJECT,
  issueMediaTicket,
  verifyMediaTicket,
};
