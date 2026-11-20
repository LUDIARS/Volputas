// GET /api/v1/play-stream/stats (SPEC-VO-PLAY-STREAM-STATS)。
// Ludellus の管理画面が読む統計。到達判定は WebSocket と同じ (loopback・Origin 許可リスト)。

const { Router } = require('express');
const { checkPlayStreamReach } = require('./playStreamReach');
const { buildPlayStreamStats } = require('./playStreamStats');

const GAME_ID = /^[A-Za-z0-9_.:-]{1,100}$/;
const MAX_SESSIONS = 500;

/**
 * @param {{ config: { allowedOrigins: string[] }, store: { listSummaries: Function }, resolveUserId: () => Promise<string> }} deps
 * @implements SPEC-VO-PLAY-STREAM-STATS
 */
function createPlayStreamRouter({ config, store, resolveUserId }) {
  const router = Router();

  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const denied = checkPlayStreamReach({ remoteAddress: req.socket?.remoteAddress, headers: req.headers }, config);
    if (denied) return res.status(denied.status).json({ ok: false, error: { code: denied.code, message: 'Not reachable from here' } });
    // ブラウザの管理画面 (別オリジン) から読むので、許可した Origin にだけ CORS を返す。
    const origin = req.headers.origin;
    if (origin) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Vary', 'Origin');
    }
    return next();
  });

  router.get('/stats', async (req, res, next) => {
    try {
      const gameId = typeof req.query.game_id === 'string' && req.query.game_id !== '' ? req.query.game_id : null;
      if (gameId !== null && !GAME_ID.test(gameId)) {
        return res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'game_id is invalid' } });
      }
      const userId = await resolveUserId();
      const rows = await store.listSummaries({ userId, gameId, limit: MAX_SESSIONS });
      return res.json({ ok: true, data: buildPlayStreamStats(rows) });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createPlayStreamRouter };
