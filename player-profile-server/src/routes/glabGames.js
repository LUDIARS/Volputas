const { Router } = require('express');
const { createCernereProjectAuth } = require('../middleware/cernereProjectAuth');
const { isCernereAdmin, requireCernereAdmin } = require('../middleware/cernereAdmin');
const { createGlabGameService } = require('../services/glabGameService');
const {
  createCorpusTransportRateLimiter,
  createCorpusUserRateLimiter,
} = require('./corpusRateLimits');

function createGlabGameRouter({
  authMiddleware = createCernereProjectAuth(),
  transportRateLimiter = createCorpusTransportRateLimiter(),
  userRateLimiter = createCorpusUserRateLimiter(),
  adminMiddleware = requireCernereAdmin,
  service = null,
  serviceProvider = null,
} = {}) {
  const router = Router();
  const ownedService = serviceProvider ? null : (service || createGlabGameService());
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
      // 停止済みゲームは管理画面からしか見えない。 学生の投稿フォームに
      // 出してしまうと、 もう受け付けていないゲームへ感想が付く。
      const includeInactive = isCernereAdmin(req.cernereUser)
        && req.query.includeInactive === 'true';
      return res.json({ ok: true, data: await resolveService().listGames({ includeInactive }) });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/', adminMiddleware, async (req, res, next) => {
    try {
      const game = await resolveService().registerGame(req.cernereUser.id, req.body);
      return res.status(201).json({ ok: true, data: game });
    } catch (error) {
      return next(error);
    }
  });

  router.patch('/:id', adminMiddleware, async (req, res, next) => {
    try {
      const game = await resolveService().updateGame(req.params.id, req.body);
      if (!game) {
        return res.status(404).json({
          ok: false,
          error: { code: 'NOT_FOUND', message: 'Game not found' },
        });
      }
      return res.json({ ok: true, data: game });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createGlabGameRouter };
