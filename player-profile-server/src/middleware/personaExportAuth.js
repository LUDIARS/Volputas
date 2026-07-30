const crypto = require('node:crypto');
const config = require('../config');
const { AppError } = require('./errorHandler');

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

function createPersonaExportAuth({ expectedToken = config.personaExport.token } = {}) {
  return function personaExportAuth(req, res, next) {
    if (!expectedToken) {
      return next(new AppError(
        503,
        'PERSONA_EXPORT_UNAVAILABLE',
        'Persona export is not configured'
      ));
    }
    if (!tokensMatch(bearerToken(req.headers.authorization), expectedToken)) {
      return res.status(401).json({
        ok: false,
        error: {
          code: 'PERSONA_EXPORT_UNAUTHORIZED',
          message: 'Invalid persona export project credential',
        },
      });
    }
    return next();
  };
}

module.exports = {
  bearerToken,
  createPersonaExportAuth,
  tokensMatch,
};
