const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');
const {
  computeAbilitySnapshot,
  getLatestAbilitySnapshot,
} = require('../services/abilityEngine');

const router = Router();
router.use(authenticate);

// Ability data is quasi-sensitive (a cognitive-ability estimate) and is exposed
// only to the authenticated subject themselves — never a cross-user API (§11).
// "me" is req.user.id (JWT sub), consistent with the tuning/me endpoint.

// GET /api/v1/games/:gameId/ability/me — latest ability snapshot for the caller.
router.get('/games/:gameId/ability/me', async (req, res, next) => {
  try {
    const snapshot = await getLatestAbilitySnapshot(req.user.id, req.params.gameId);
    if (!snapshot) throw new AppError(404, 'NOT_FOUND', 'No ability snapshot for game');
    res.json({ ok: true, data: snapshot });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/games/:gameId/ability/recompute — recompute + persist the caller's
// snapshot on demand (mirrors POST /analysis/me). The session-end job computes
// this automatically; this endpoint is the explicit, testable trigger.
router.post('/games/:gameId/ability/recompute', async (req, res, next) => {
  try {
    const deviceClass = typeof req.body?.device_class === 'string' ? req.body.device_class : undefined;
    const snapshot = await computeAbilitySnapshot(req.user.id, req.params.gameId, { deviceClass });
    res.status(201).json({ ok: true, data: snapshot });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
