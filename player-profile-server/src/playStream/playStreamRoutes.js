// GET /api/v1/play-stream/stats (SPEC-VO-PLAY-STREAM-STATS)。
// Ludellus の管理画面が中継を通して読む、その本人 (中継が渡す Cernere の user id) の統計。
// 到達と本人の判定は WebSocket と同じ (playStreamReach)。

const { Router } = require('express');
const { checkPlayStreamRelay } = require('./playStreamReach');
const { buildPlayStreamStats } = require('./playStreamStats');

const GAME_ID = /^[A-Za-z0-9_.:-]{1,100}$/;
const MAX_SESSIONS = 500;

/**
 * @param {{ config: { relayTokenDigest: Buffer }, store: { listSummaries: Function }, resolveUserId: (cernereSub: string) => Promise<string> }} deps
 * @implements SPEC-VO-PLAY-STREAM-STATS
 */
function createPlayStreamRouter({ config, store, resolveUserId }) {
  const router = Router();

  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const reach = checkPlayStreamRelay({ remoteAddress: req.socket?.remoteAddress, headers: req.headers }, config);
    if (!reach.cernereSub) return res.status(reach.status).json({ ok: false, error: { code: reach.code, message: 'Not reachable from here' } });
    req.playStreamCernereSub = reach.cernereSub;
    return next();
  });

  router.get('/stats', async (req, res, next) => {
    try {
      const gameId = typeof req.query.game_id === 'string' && req.query.game_id !== '' ? req.query.game_id : null;
      if (gameId !== null && !GAME_ID.test(gameId)) {
        return res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'game_id is invalid' } });
      }
      const userId = await resolveUserId(req.playStreamCernereSub);
      const rows = await store.listSummaries({ userId, gameId, limit: MAX_SESSIONS });
      return res.json({ ok: true, data: buildPlayStreamStats(rows) });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createPlayStreamRouter };
