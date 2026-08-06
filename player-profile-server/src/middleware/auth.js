const jwt = require('jsonwebtoken');
const config = require('../config');
const { getSigningKey } = require('../services/jwks');
const { authenticateHasterPublicToken } = require('../haster/publicTestIdentity');

function sendUnauthorized(res, message) {
  return res.status(401).json({
    ok: false,
    error: { code: 'UNAUTHORIZED', message },
  });
}

// @implements SPEC-HASTER-PUBLIC-IDENTITY
async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  const hasterUser = authenticateHasterPublicToken(authHeader, config.haster.enabled);
  if (hasterUser) {
    req.user = hasterUser;
    return next();
  }
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return sendUnauthorized(res, 'Missing or invalid Authorization header');
  }

  const token = authHeader.slice(7);

  try {
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded) {
      return sendUnauthorized(res, 'Invalid token');
    }

    const key = await getSigningKey(decoded.header.kid);
    const payload = jwt.verify(token, key.publicKey, {
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
      algorithms: ['RS256'],
    });

    req.user = { id: payload.sub, jti: payload.jti, issuedAt: payload.iat };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return sendUnauthorized(res, 'Token expired');
    }
    return sendUnauthorized(res, 'Invalid token');
  }
}

module.exports = { authenticate };
