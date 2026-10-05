const crypto = require('node:crypto');
const config = require('../config');
const { AppError } = require('./errorHandler');
const { InvalidCernereTokenError } = require('../integrations/cernere/cernereErrors');
const { CernerePublicKeyProvider } = require('../integrations/cernere/publicKeyProvider');
const {
  CernereProjectTokenVerifier,
  VOLUPTAS_PROJECT_KEY,
  serviceClaimsSchema,
} = require('../integrations/cernere/projectTokenVerifier');

// P4 (auth-plane consolidation): the same Authorization header carries either a
// Cernere service token (PASETO) or the legacy fixed token. Both are accepted
// until P5 removes the fixed token.
const SERVICE_TOKEN_PREFIX = 'v4.public.';
const PERSONA_EXPORT_SCOPE = 'persona-export:read';

function bearerToken(header) {
  if (typeof header !== 'string') return null;
  return /^Bearer ([^\s]+)$/.exec(header)?.[1] || null;
}

function tokensMatch(actual, expected) {
  if (!actual || !expected) return false;
  const actualBytes = Buffer.from(actual, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  return actualBytes.length === expectedBytes.length
    && crypto.timingSafeEqual(actualBytes, expectedBytes);
}

/** @implements SPEC-AUTH-P4-SERVICE-TOKEN */
function defaultServiceTokenVerifier() {
  return new CernereProjectTokenVerifier({
    // aud of a service token is the callee's Cernere storage_slug.
    audience: VOLUPTAS_PROJECT_KEY,
    keyProvider: new CernerePublicKeyProvider({ baseUrl: config.cernere.baseUrl }),
    claimsSchema: serviceClaimsSchema,
  });
}

function sendUnauthorized(res) {
  return res.status(401).json({
    ok: false,
    error: {
      code: 'PERSONA_EXPORT_UNAUTHORIZED',
      message: 'Invalid persona export project credential',
    },
  });
}

/** @implements SPEC-AUTH-P4-SERVICE-TOKEN */
async function authorizeServiceToken(token, verifier, res, next) {
  let claims;
  try {
    claims = await verifier.verify(token);
  } catch (error) {
    if (error instanceof InvalidCernereTokenError) return sendUnauthorized(res);
    return next(error);
  }
  // Authorize by scope only; never branch on the caller (`sub`).
  if (!claims.scope.includes(PERSONA_EXPORT_SCOPE)) {
    return res.status(403).json({
      ok: false,
      error: {
        code: 'PERSONA_EXPORT_FORBIDDEN',
        message: `Service token lacks the ${PERSONA_EXPORT_SCOPE} scope`,
      },
    });
  }
  return next();
}

/** @implements SPEC-AUTH-P4-SERVICE-TOKEN */
function createPersonaExportAuth({
  expectedToken = config.personaExport.token,
  serviceTokenVerifier,
} = {}) {
  let verifier = serviceTokenVerifier || null;
  return function personaExportAuth(req, res, next) {
    const presented = bearerToken(req.headers.authorization);
    if (presented?.startsWith(SERVICE_TOKEN_PREFIX)) {
      verifier ||= defaultServiceTokenVerifier();
      return authorizeServiceToken(presented, verifier, res, next);
    }
    if (!expectedToken) {
      return next(new AppError(
        503,
        'PERSONA_EXPORT_UNAVAILABLE',
        'Persona export is not configured'
      ));
    }
    if (!tokensMatch(presented, expectedToken)) return sendUnauthorized(res);
    return next();
  };
}

module.exports = {
  PERSONA_EXPORT_SCOPE,
  bearerToken,
  createPersonaExportAuth,
  tokensMatch,
};
