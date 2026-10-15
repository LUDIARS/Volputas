// AI プレイテスト感想の受け口 (Ingenium `ingenium playtest` が送る)。
//   POST /  感想を 1 件保存する (Idempotency-Key = run_id。再送は同じ記録を 200 で返す)
//   GET  /  感想の一覧 (?game=<ゲーム名か game_id>&limit=1-200)
// 保存先とモード固有の文脈 (ローカルのデータリポジトリ) は resolveContext が決める。
const { Router } = require('express');

/** @implements SPEC-VO-AI-PLAYTEST-REVIEWS */
function createAiPlaytestReviewRouter({ serviceProvider, writeAuth, readAuth = null, resolveContext = async () => ({}) }) {
  if (typeof serviceProvider !== 'function') throw new TypeError('serviceProvider is required');
  if (typeof writeAuth !== 'function') throw new TypeError('writeAuth is required');
  const router = Router();

  router.post('/', writeAuth, async (req, res, next) => {
    try {
      const context = await resolveContext(req);
      const result = await serviceProvider().create({ idempotencyKey: req.get('Idempotency-Key'), body: req.body, context });
      res.set('Cache-Control', 'private, no-store');
      return res.status(result.created ? 201 : 200).json({ ok: true, data: { review: result.review } });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/', ...(readAuth ? [readAuth] : []), async (req, res, next) => {
    try {
      const game = typeof req.query.game === 'string' && req.query.game.trim() ? req.query.game.trim() : null;
      const limit = req.query.limit === undefined ? undefined : Number(req.query.limit);
      const context = await resolveContext(req);
      const reviews = await serviceProvider().list({ game, ...(limit === undefined ? {} : { limit }), context });
      res.set('Cache-Control', 'private, no-store');
      return res.status(200).json({ ok: true, data: { reviews } });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createAiPlaytestReviewRouter };
