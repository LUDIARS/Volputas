const config = require('../config');
const {
  InvalidCernereTokenError,
} = require('../integrations/cernere/cernereErrors');
const {
  CernerePublicKeyProvider,
} = require('../integrations/cernere/publicKeyProvider');
const {
  CernereProjectTokenVerifier,
} = require('../integrations/cernere/projectTokenVerifier');

function sendUnauthorized(res) {
  return res.status(401).json({
    ok: false,
    error: {
      code: 'CERNERE_UNAUTHORIZED',
      message: 'Invalid Cernere project token',
    },
  });
}

function bearerToken(header) {
  if (typeof header !== 'string') return null;
  const match = /^Bearer ([^\s]+)$/.exec(header);
  return match?.[1] || null;
}

function defaultVerifier() {
  const keyProvider = new CernerePublicKeyProvider({
    baseUrl: config.cernere.baseUrl,
  });
  return new CernereProjectTokenVerifier({
    audience: config.cernere.audience,
    keyProvider,
  });
}

function createCernereProjectAuth({ verifier = defaultVerifier() } = {}) {
  return async function cernereProjectAuth(req, res, next) {
    const token = bearerToken(req.headers.authorization);
    if (!token) return sendUnauthorized(res);

    try {
      const claims = await verifier.verify(token);
      req.cernereUser = { id: claims.sub };
      return next();
    } catch (error) {
      if (error instanceof InvalidCernereTokenError || error?.statusCode === 401) {
        return sendUnauthorized(res);
      }
      return next(error);
    }
  };
}

module.exports = {
  bearerToken,
  createCernereProjectAuth,
};
