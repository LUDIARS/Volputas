const { Router } = require('express');
const { createCernereProjectAuth } = require('../middleware/cernereProjectAuth');
const { requireCernereAdmin } = require('../middleware/cernereAdmin');
const { createGlabSurveyService } = require('../services/glabSurveyService');
const {
  cernereUserKey,
  createCorpusTransportRateLimiter,
  createCorpusUserRateLimiter,
} = require('./corpusRateLimits');

function createGlabSurveyRouter({
  authMiddleware = createCernereProjectAuth(),
  transportRateLimiter = createCorpusTransportRateLimiter(),
  userRateLimiter = createCorpusUserRateLimiter(),
  adminMiddleware = requireCernereAdmin,
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
        // ゲーム別アンケートの絞り込み。 未指定なら全件 (ゲーム非紐付けを含む)。
        req.query.gameId,
      );
      return res.json({ ok: true, data: surveys });
    } catch (error) {
      return next(error);
    }
  });

  // 以降 2 本は管理者専用。 設問の正本は Volputas なので、 登録も公開切替も
  // ここで受ける (GLAB は画面と中継だけを持つ)。
  router.post('/', adminMiddleware, async (req, res, next) => {
    try {
      const survey = await resolveService().createSurvey(req.body);
      return res.status(201).json({ ok: true, data: survey });
    } catch (error) {
      return next(error);
    }
  });

  router.patch('/:id', adminMiddleware, async (req, res, next) => {
    try {
      const survey = await resolveService().updateSurvey(req.params.id, req.body);
      if (!survey) {
        return res.status(404).json({
          ok: false,
          error: { code: 'NOT_FOUND', message: 'Survey not found' },
        });
      }
      return res.json({ ok: true, data: survey });
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
  // 実体は routes/corpusRateLimits。 既存の呼び出し側 (app.js / テスト) が
  // このモジュール名で参照しているため、 移設後も入口を残す。
  cernereUserKey,
  createCorpusTransportRateLimiter,
  createGlabSurveyRouter,
};
