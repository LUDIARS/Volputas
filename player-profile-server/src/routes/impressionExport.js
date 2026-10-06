const { Router } = require('express');
const { createPersonaExportAuth } = require('../middleware/personaExportAuth');

/**
 * 遊んだ感想の書き出し (Discutere のユーザーの声の材料)。
 * ペルソナ書き出しと同じサービス間認証 (Cernere service token、scope persona-export:read /
 * 移行期間の固定トークン) で受ける。書き手の情報は含めない (glabReviewService.listImpressions)。
 * @implements SPEC-GLAB-IMPRESSION-EXPORT
 */
function createImpressionExportRouter({
  authenticateMiddleware = createPersonaExportAuth(),
  serviceProvider,
} = {}) {
  if (typeof serviceProvider !== 'function') {
    throw new TypeError('serviceProvider is required');
  }
  const router = Router();
  router.use(authenticateMiddleware);
  router.get('/', async (req, res, next) => {
    const game = typeof req.query.game === 'string' && req.query.game.trim() ? req.query.game.trim() : null;
    const limit = req.query.limit === undefined ? 50 : Number(req.query.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
      return res.status(400).json({
        ok: false,
        error: { code: 'INVALID_EXPORT_LIMIT', message: 'limit must be 1-200' },
      });
    }
    try {
      const impressions = await serviceProvider().listImpressions({ game, limit });
      res.set('Cache-Control', 'private, no-store');
      return res.status(200).json({ ok: true, data: { impressions } });
    } catch (error) {
      return next(error);
    }
  });
  return router;
}

module.exports = { createImpressionExportRouter };
