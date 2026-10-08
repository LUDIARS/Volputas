const config = require('../config');
const { AppError } = require('./errorHandler');
const { bearerToken } = require('./personaExportAuth');
const { InvalidCernereTokenError } = require('../integrations/cernere/cernereErrors');
const { CernerePublicKeyProvider } = require('../integrations/cernere/publicKeyProvider');
const { CernereProjectTokenVerifier, VOLUPTAS_PROJECT_KEY, serviceClaimsSchema } = require('../integrations/cernere/projectTokenVerifier');

const IMPRESSION_REQUEST_SCOPE = 'impression-requests:write';

/** 収集依頼の受付・照合専用。既存の export:read や固定読み取りトークンに書き込み権限を足さない。 */
function createImpressionRequestAuth({ verifier } = {}) {
  let tokenVerifier = verifier;
  return async (req, res, next) => {
    const token = bearerToken(req.headers.authorization);
    if (!token?.startsWith('v4.public.')) return next(new AppError(401, 'IMPRESSION_REQUEST_UNAUTHORIZED', 'Service token required'));
    try {
      tokenVerifier ||= new CernereProjectTokenVerifier({
        audience: VOLUPTAS_PROJECT_KEY,
        keyProvider: new CernerePublicKeyProvider({ baseUrl: config.cernere.baseUrl }),
        claimsSchema: serviceClaimsSchema,
      });
      const claims = await tokenVerifier.verify(token);
      if (!claims.scope.includes(IMPRESSION_REQUEST_SCOPE)) return next(new AppError(403, 'IMPRESSION_REQUEST_FORBIDDEN', `Service token lacks ${IMPRESSION_REQUEST_SCOPE}`));
      req.impressionRequester = claims.sub; // 依頼元ごとの識別。認可は scope で判定する。
      return next();
    } catch (error) {
      return next(error instanceof InvalidCernereTokenError
        ? new AppError(401, 'IMPRESSION_REQUEST_UNAUTHORIZED', 'Invalid service token') : error);
    }
  };
}

module.exports = { createImpressionRequestAuth, IMPRESSION_REQUEST_SCOPE };
