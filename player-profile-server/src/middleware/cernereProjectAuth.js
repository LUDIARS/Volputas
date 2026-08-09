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
      // role / displayName は Cernere が users 行から載せる任意クレーム。 管理者
      // 判定 (cernereAdmin) が読むので、 ここで落とさず素通しする。 未載せの
      // トークンでは role が undefined になり、 管理者扱いにはならない。
      req.cernereUser = {
        id: claims.sub,
        role: claims.role || null,
        displayName: claims.displayName || null,
      };
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
