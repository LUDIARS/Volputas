const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { AppError } = require('../middleware/errorHandler');
const steamModel = require('../models/steamModel');
const steamService = require('../services/steamService');

const router = Router();

router.use(authenticate);

function mapSteamError(err) {
  if (err.code === 'STEAM_NOT_CONFIGURED') return new AppError(503, err.code, 'Steam integration is not configured');
  if (err.code === 'STEAM_RESOLVE_FAILED') return new AppError(400, err.code, err.message);
  if (err.code === 'STEAM_PROFILE_NOT_FOUND') return new AppError(404, err.code, err.message);
  if (err.code === 'STEAM_API_ERROR') return new AppError(502, err.code, err.message);
  return err;
}

// GET /api/v1/users/me/steam — link status + top games by playtime
router.get('/', async (req, res, next) => {
  try {
    const profile = await steamModel.getProfile(req.user.id);
    if (!profile) return res.json({ ok: true, data: { linked: false } });
    const topGames = await steamModel.getTopGamesByPlaytime(req.user.id, 10);
    res.json({ ok: true, data: { linked: true, profile, topGames } });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/users/me/steam/link — { steamId: SteamID64 | vanity name | profile URL }
router.post('/link', validate({
  body: { steamId: { required: true, type: 'string', maxLength: 200 } },
}), async (req, res, next) => {
  try {
    const steamId64 = await steamService.resolveSteamId64(req.body.steamId);

    const existing = await steamModel.findByProviderSteamId(steamId64);
    if (existing && existing.user_id !== req.user.id) {
      throw new AppError(409, 'ALREADY_LINKED', 'This Steam account is already linked to another user');
    }

    const summary = await steamService.fetchPlayerSummary(steamId64);
    if (summary.visibilityState !== 3) {
      throw new AppError(400, 'STEAM_PROFILE_PRIVATE', 'Steam profile must be public to link');
    }

    await steamModel.upsertProfile(req.user.id, summary);
    const games = await steamService.fetchOwnedGames(steamId64);
    await steamModel.replaceOwnedGames(req.user.id, games);

    const profile = await steamModel.getProfile(req.user.id);
    res.status(201).json({ ok: true, data: { linked: true, profile, gameCount: games.length } });
  } catch (err) {
    next(mapSteamError(err));
  }
});

// POST /api/v1/users/me/steam/sync — re-fetch owned games for the already-linked account
router.post('/sync', async (req, res, next) => {
  try {
    const profile = await steamModel.getProfile(req.user.id);
    if (!profile) throw new AppError(404, 'NOT_LINKED', 'No Steam account linked');

    const games = await steamService.fetchOwnedGames(profile.steam_id64);
    await steamModel.replaceOwnedGames(req.user.id, games);

    const updated = await steamModel.getProfile(req.user.id);
    res.json({ ok: true, data: { linked: true, profile: updated, gameCount: games.length } });
  } catch (err) {
    next(mapSteamError(err));
  }
});

// DELETE /api/v1/users/me/steam — unlink
router.delete('/', async (req, res, next) => {
  try {
    const profile = await steamModel.getProfile(req.user.id);
    if (!profile) throw new AppError(404, 'NOT_LINKED', 'No Steam account linked');

    await steamModel.deleteByUserId(req.user.id);
    res.json({ ok: true, data: { message: 'Steam account unlinked' } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
