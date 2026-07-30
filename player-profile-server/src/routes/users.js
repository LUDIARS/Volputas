const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const userModel = require('../models/userModel');
const identityModel = require('../models/identityModel');
const { revokeAllTokens } = require('../services/tokenService');
const { AppError } = require('../middleware/errorHandler');

const router = Router();

// All routes require authentication
router.use(authenticate);

// GET /api/v1/users/me
router.get('/me', async (req, res, next) => {
  try {
    const user = await userModel.findById(req.user.id);
    if (!user) {
      throw new AppError(404, 'NOT_FOUND', 'User not found');
    }
    res.json({ ok: true, data: user });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/users/me
router.patch('/me', validate({
  body: {
    display_name: { type: 'string', maxLength: 100 },
    avatar_url: { type: 'string' },
    locale: { type: 'string', maxLength: 10 },
    research_export_consent: { type: 'boolean' },
  },
}), async (req, res, next) => {
  try {
    const {
      display_name,
      avatar_url,
      locale,
      research_export_consent,
    } = req.body;
    const user = await userModel.update(req.user.id, {
      displayName: display_name,
      avatarUrl: avatar_url,
      locale,
      researchExportConsent: research_export_consent,
    });
    if (!user) {
      throw new AppError(404, 'NOT_FOUND', 'User not found');
    }
    res.json({ ok: true, data: user });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/users/me
router.delete('/me', async (req, res, next) => {
  try {
    const ageSeconds = Math.floor(Date.now() / 1000) - Number(req.user.issuedAt || 0);
    if (ageSeconds > 300) {
      throw new AppError(401, 'RECENT_AUTH_REQUIRED', 'Account deletion requires a token issued within 5 minutes');
    }
    const deleted = await userModel.softDelete(req.user.id);
    if (!deleted) {
      throw new AppError(404, 'NOT_FOUND', 'User not found');
    }
    await revokeAllTokens(req.user.id);
    res.json({ ok: true, data: { message: 'Account deleted' } });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/users/me/identities
router.get('/me/identities', async (req, res, next) => {
  try {
    const identities = await identityModel.findByUserId(req.user.id);
    res.json({ ok: true, data: identities });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/users/me/identities
router.post('/me/identities', validate({
  body: {
    provider: { required: true, type: 'string', enum: ['google', 'discord'] },
    provider_sub: { required: true, type: 'string' },
    email: { type: 'string' },
    raw_profile: { type: 'object' },
  },
}), async (req, res, next) => {
  try {
    const { provider, provider_sub, email, raw_profile } = req.body;

    // Check if this provider_sub is already linked to another user
    const existing = await identityModel.findByProviderSub(provider, provider_sub);
    if (existing) {
      throw new AppError(409, 'ALREADY_LINKED', 'This identity is already linked to an account');
    }

    const identity = await identityModel.create({
      userId: req.user.id,
      provider,
      providerSub: provider_sub,
      email,
      rawProfile: raw_profile,
    });

    res.status(201).json({ ok: true, data: identity });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/users/me/identities/:provider
router.delete('/me/identities/:provider', async (req, res, next) => {
  try {
    // Ensure at least one identity remains
    const count = await identityModel.countByUserId(req.user.id);
    if (count <= 1) {
      throw new AppError(400, 'LAST_IDENTITY', 'Cannot remove the last linked identity');
    }

    const deleted = await identityModel.deleteByProvider(req.user.id, req.params.provider);
    if (!deleted) {
      throw new AppError(404, 'NOT_FOUND', 'Identity not found');
    }

    res.json({ ok: true, data: { message: 'Identity unlinked' } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
