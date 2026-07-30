const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const { createCernereProjectAuth } = require('../middleware/cernereProjectAuth');
const { asInputError } = require('../middleware/errorHandler');

const RATE_LIMIT_MESSAGE = {
  ok: false,
  error: { code: 'RATE_LIMIT', message: 'Too many requests' },
};

function positiveInteger(value, fallback, maximum, minimum = 0) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) return null;
  return parsed;
}

function createGlabReviewRouter({
  authMiddleware = createCernereProjectAuth(),
  transportRateLimiter = rateLimit({
    windowMs: config.rateLimit.general.windowMs,
    max: config.rateLimit.general.max * 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: RATE_LIMIT_MESSAGE,
  }),
  userRateLimiter = rateLimit({
    windowMs: config.rateLimit.general.windowMs,
    max: config.rateLimit.general.max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.cernereUser.id,
    message: RATE_LIMIT_MESSAGE,
  }),
  serviceProvider,
  recentGamesProvider = null,
} = {}) {
  const router = Router();
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    next();
  });
  if (transportRateLimiter) router.use(transportRateLimiter);
  router.use(authMiddleware);
  router.use(userRateLimiter);

  router.get('/', async (req, res, next) => {
    // limit starts at 1: a zero limit is ambiguous downstream, where some
    // backends read it as "no limit".
    const limit = positiveInteger(req.query.limit, 50, 50, 1);
    const offset = positiveInteger(req.query.offset, 0, Number.MAX_SAFE_INTEGER);
    if (limit === null || offset === null) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'INVALID_PROFILE_INPUT',
          message: 'limit must be 1-50 and offset must be a non-negative integer',
        },
      });
    }
    try {
      return res.json({ ok: true, data: await serviceProvider().list({
        glabProjectId: typeof req.query.projectId === 'string' ? req.query.projectId : null,
        limit,
        offset,
      }) });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const record = await serviceProvider().create(req.cernereUser.id, req.body);
      return res.status(201).json({ ok: true, data: { record } });
    } catch (error) {
      return next(asInputError(error));
    }
  });

  router.get('/recent-games', async (req, res, next) => {
    try {
      const games = recentGamesProvider
        ? await recentGamesProvider(req.cernereUser.id)
        : [];
      return res.json({
        ok: true,
        data: games.slice(0, 20).map((game) => ({
          name: game.name,
          playtimeTwoWeeksMinutes: game.playtime_2weeks_minutes,
        })),
      });
    } catch (error) {
      return next(error);
    }
  });
  return router;
}

module.exports = { createGlabReviewRouter, positiveInteger };
