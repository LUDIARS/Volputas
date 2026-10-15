// AI プレイテスト感想の受け口のサービス間認証。Cernere service token (scope ai-playtest:write) か、
// この受け口専用の固定トークン (VOLUPTAS_AI_PLAYTEST_TOKEN) を受ける。固定トークンが未設定なら 503
// (受け口は閉じている)。ローカルモードは Cernere が無いので固定トークンだけ。
const { AppError } = require('./errorHandler');
const { InvalidCernereTokenError } = require('../integrations/cernere/cernereErrors');
const { SERVICE_TOKEN_PREFIX, bearerToken, defaultServiceTokenVerifier, tokensMatch } = require('./personaExportAuth');

const AI_PLAYTEST_WRITE_SCOPE = 'ai-playtest:write';

function unauthorized(res) {
  return res.status(401).json({ ok: false, error: { code: 'AI_PLAYTEST_UNAUTHORIZED', message: 'Invalid AI playtest credential' } });
}

/** @implements SPEC-VO-AI-PLAYTEST-REVIEWS */
function createAiPlaytestAuth({ expectedToken, serviceTokens = true, serviceTokenVerifier = null }) {
  let verifier = serviceTokenVerifier;
  return async function aiPlaytestAuth(req, res, next) {
    const presented = bearerToken(req.headers.authorization);
    if (serviceTokens && presented?.startsWith(SERVICE_TOKEN_PREFIX)) {
      verifier ||= defaultServiceTokenVerifier();
      let claims;
      try {
        claims = await verifier.verify(presented);
      } catch (error) {
        if (error instanceof InvalidCernereTokenError) return unauthorized(res);
        return next(error);
      }
      if (!claims.scope.includes(AI_PLAYTEST_WRITE_SCOPE)) {
        return res.status(403).json({ ok: false, error: { code: 'AI_PLAYTEST_FORBIDDEN', message: `Service token lacks the ${AI_PLAYTEST_WRITE_SCOPE} scope` } });
      }
      return next();
    }
    if (!expectedToken) return next(new AppError(503, 'AI_PLAYTEST_UNAVAILABLE', 'AI playtest reviews are not configured'));
    if (!tokensMatch(presented, expectedToken)) return unauthorized(res);
    return next();
  };
}

module.exports = { AI_PLAYTEST_WRITE_SCOPE, createAiPlaytestAuth };
