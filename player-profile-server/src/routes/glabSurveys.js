const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const { createCernereProjectAuth } = require('../middleware/cernereProjectAuth');
const { createGlabSurveyService } = require('../services/glabSurveyService');

function cernereUserKey(req) {
  return req.cernereUser.id;
}

function createCorpusTransportRateLimiter() {
  return rateLimit({
    windowMs: config.rateLimit.general.windowMs,
    max: config.rateLimit.general.max * 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, error: { code: 'RATE_LIMIT', message: 'Too many requests' } },
  });
}

function createGlabSurveyRouter({
  authMiddleware = createCernereProjectAuth(),
  transportRateLimiter = createCorpusTransportRateLimiter(),
  userRateLimiter = rateLimit({
    windowMs: config.rateLimit.general.windowMs,
    max: config.rateLimit.general.max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: cernereUserKey,
    message: { ok: false, error: { code: 'RATE_LIMIT', message: 'Too many requests' } },
  }),
  service = null,
  serviceProvider = null,
} = {}) {
  const router = Router();
  const ownedService = serviceProvider ? null : (service || createGlabSurveyService());
  const resolveService = serviceProvider || (() => ownedService);

  router.use((_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    next();
  });
  if (transportRateLimiter) router.use(transportRateLimiter);
  router.use(authMiddleware);
  router.use(userRateLimiter);

  router.get('/', async (req, res, next) => {
    try {
      const surveys = await resolveService().listSurveys(
        req.cernereUser.id,
        req.query.category,
      );
      return res.json({ ok: true, data: surveys });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const result = await resolveService().getSurvey(
        req.cernereUser.id,
        req.params.id,
      );
      if (!result) {
        return res.status(404).json({
          ok: false,
          error: { code: 'NOT_FOUND', message: 'Survey not found' },
        });
      }
      return res.json({ ok: true, data: result });
    } catch (error) {
      return next(error);
    }
  });

  router.put('/:id/response', async (req, res, next) => {
    try {
      const result = await resolveService().saveResponse(
        req.cernereUser.id,
        req.params.id,
        req.body?.answers,
      );
      if (!result) {
        return res.status(404).json({
          ok: false,
          error: { code: 'NOT_FOUND', message: 'Survey not found' },
        });
      }
      return res.json({ ok: true, data: result });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = {
  cernereUserKey,
  createCorpusTransportRateLimiter,
  createGlabSurveyRouter,
};
