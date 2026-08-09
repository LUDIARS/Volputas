// GLAB (Corpus) 連携ルート共通のレート制限。
//
// Corpus は全ユーザ分のリクエストを 1 本の接続元から中継してくるため、 転送元
// IP でのしきい値 (transport) と、 トークンの利用者単位のしきい値 (user) を
// 分けないと、 利用者が増えるほど全員が転送元の枠で詰まる。
const rateLimit = require('express-rate-limit');
const config = require('../config');

const RATE_LIMIT_MESSAGE = Object.freeze({
  ok: false,
  error: { code: 'RATE_LIMIT', message: 'Too many requests' },
});

function cernereUserKey(req) {
  return req.cernereUser.id;
}

function createCorpusTransportRateLimiter() {
  return rateLimit({
    windowMs: config.rateLimit.general.windowMs,
    max: config.rateLimit.general.max * 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: RATE_LIMIT_MESSAGE,
  });
}

function createCorpusUserRateLimiter() {
  return rateLimit({
    windowMs: config.rateLimit.general.windowMs,
    max: config.rateLimit.general.max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: cernereUserKey,
    message: RATE_LIMIT_MESSAGE,
  });
}

module.exports = {
  RATE_LIMIT_MESSAGE,
  cernereUserKey,
  createCorpusTransportRateLimiter,
  createCorpusUserRateLimiter,
};
