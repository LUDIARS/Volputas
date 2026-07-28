const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const impressionService = require('../services/impressionService');

function createImpressionRouter(service = impressionService) {
  const router = Router();
  router.use(authenticate);

  router.post('/sessions/:sessionId/impressions', validate({
    params: { sessionId: { required: true, type: 'uuid' } },
  }), async (req, res, next) => {
    try {
      const result = await service.create({
        sessionId: req.params.sessionId,
        userId: req.user.id,
        idempotencyKey: req.get('Idempotency-Key'),
        body: req.body,
      });
      return res.status(result.created ? 201 : 200).json({ ok: true, data: result.impression });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/impressions/:id/complete', validate({
    params: { id: { required: true, type: 'uuid' } },
  }), async (req, res, next) => {
    try {
      const impression = await service.complete({ impressionId: req.params.id, userId: req.user.id });
      return res.json({ ok: true, data: impression });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/impressions/:id', validate({
    params: { id: { required: true, type: 'uuid' } },
  }), async (req, res, next) => {
    try {
      const impression = await service.get({ impressionId: req.params.id, userId: req.user.id });
      return res.json({ ok: true, data: impression });
    } catch (error) {
      return next(error);
    }
  });

  router.delete('/impressions/:id', validate({
    params: { id: { required: true, type: 'uuid' } },
  }), async (req, res, next) => {
    try {
      await service.remove({ impressionId: req.params.id, userId: req.user.id });
      return res.status(204).end();
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = createImpressionRouter();
module.exports.createImpressionRouter = createImpressionRouter;
