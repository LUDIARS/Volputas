const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const reactionService = require('../services/impressionReactionService');
const reactionAnalysisService = require('../services/impressionReactionAnalysisService');

function createImpressionReactionRouter(service = reactionService, analysisService = reactionAnalysisService) {
  const router = Router();
  router.use(authenticate);
  const impressionParams = { id: { required: true, type: 'uuid' } };

  router.get('/impressions/:id/reactions', validate({ params: impressionParams }), async (req, res, next) => {
    try {
      const reactions = await service.list({ impressionId: req.params.id, userId: req.user.id });
      return res.json({ ok: true, data: reactions });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/impressions/:id/reactions', validate({ params: impressionParams }), async (req, res, next) => {
    try {
      const reaction = await service.add({
        impressionId: req.params.id,
        userId: req.user.id,
        body: req.body,
      });
      return res.status(201).json({ ok: true, data: reaction });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/impressions/:id/reactions/raw', validate({ params: impressionParams }), async (req, res, next) => {
    try {
      const raw = await analysisService.rawData({ impressionId: req.params.id, userId: req.user.id });
      return res.json({ ok: true, data: raw });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/impressions/:id/reactions/timeline', validate({ params: impressionParams }), async (req, res, next) => {
    try {
      const timeline = await analysisService.createTimeline({
        impressionId: req.params.id,
        userId: req.user.id,
        binMs: req.body?.bin_ms ?? 30_000,
      });
      return res.status(201).json({ ok: true, data: timeline });
    } catch (error) {
      return next(error);
    }
  });

  router.delete('/impressions/:id/reactions/:reactionId', validate({
    params: {
      id: { required: true, type: 'uuid' },
      reactionId: { required: true, type: 'uuid' },
    },
  }), async (req, res, next) => {
    try {
      await service.remove({
        reactionId: req.params.reactionId,
        impressionId: req.params.id,
        userId: req.user.id,
      });
      return res.status(204).end();
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = createImpressionReactionRouter();
module.exports.createImpressionReactionRouter = createImpressionReactionRouter;
