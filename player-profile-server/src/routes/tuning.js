const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');
const { getTuningParams } = require('../services/tuningParams');

const router = Router();
router.use(authenticate);

// GET /api/v1/games/:gameId/tuning/me — current user's tuning params for a game.
// "me" is the authenticated principal (req.user.id from the JWT sub), matching
// the session/user-identification convention used across this service.
router.get('/games/:gameId/tuning/me', async (req, res, next) => {
  try {
    const tuning = await getTuningParams(req.user.id, req.params.gameId);
    if (!tuning) throw new AppError(404, 'NOT_FOUND', 'Tuning params not found for game');
    res.json({ ok: true, data: tuning });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
