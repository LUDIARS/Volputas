const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { createImpressionDiscussionService } = require('../services/impressionDiscussionService');

/** @implements SPEC-VOLPUTAS-DISCUTERE-REVIEW-DISCUSSION */
function createImpressionDiscussionRouter({
  service = createImpressionDiscussionService(),
} = {}) {
  const router = Router();
  router.use(authenticate);
  /** @implements SPEC-VOLPUTAS-DISCUTERE-REVIEW-DISCUSSION */
  async function startDiscussion(req, res, next) {
    try {
      const result = await service.start({ impressionId: req.params.id, userId: req.user.id });
      res.set('Cache-Control', 'private, no-store');
      return res.status(201).json({ ok: true, data: result });
    } catch (error) {
      return next(error);
    }
  }

  router.post('/impressions/:id/discussions', validate({
    params: { id: { required: true, type: 'uuid' } },
  }), startDiscussion);
  return router;
}

module.exports = {
  createImpressionDiscussionRouter,
  router: createImpressionDiscussionRouter(),
};
