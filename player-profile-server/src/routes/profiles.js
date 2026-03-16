const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const profileModel = require('../models/profileModel');
const userModel = require('../models/userModel');
const { AppError } = require('../middleware/errorHandler');

const router = Router();

router.use(authenticate);

// GET /api/v1/users/me/profile
router.get('/me/profile', async (req, res, next) => {
  try {
    let profile = await profileModel.findByUserId(req.user.id);
    if (!profile) {
      // Auto-create empty profile
      profile = await profileModel.upsert(req.user.id, {});
    }
    res.json({ ok: true, data: profile });
  } catch (err) {
    next(err);
  }
});

// PUT /api/v1/users/me/profile
router.put('/me/profile', validate({
  body: {
    playstyle_tags: { type: 'array' },
    personality_data: { type: 'object' },
  },
}), async (req, res, next) => {
  try {
    const { playstyle_tags, personality_data } = req.body;
    const profile = await profileModel.upsert(req.user.id, {
      playstyleTags: playstyle_tags,
      personalityData: personality_data,
    });
    res.json({ ok: true, data: profile });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/users/:id/profile — public profile
router.get('/:id/profile', validate({
  params: { id: { required: true, type: 'uuid' } },
}), async (req, res, next) => {
  try {
    const user = await userModel.findById(req.params.id);
    if (!user) {
      throw new AppError(404, 'NOT_FOUND', 'User not found');
    }

    const profile = await profileModel.findByUserId(req.params.id);
    if (!profile) {
      throw new AppError(404, 'NOT_FOUND', 'Profile not found');
    }

    // Return public subset
    res.json({
      ok: true,
      data: {
        user_id: profile.user_id,
        display_name: user.display_name,
        avatar_url: user.avatar_url,
        playstyle_tags: profile.playstyle_tags,
        preference_vector: profile.preference_vector,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
