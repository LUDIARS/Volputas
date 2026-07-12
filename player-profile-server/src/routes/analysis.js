const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const {
  analyzeUser,
  DIMENSIONS,
  CLASSIFICATION_SCHEMA,
  GAMER_TYPES,
  MECHANICS_TYPES,
  STORY_TYPES,
} = require('../services/analysisEngine');
const { getPreferenceAxes } = require('../services/preferenceAxes');
const { getAffectProfile } = require('../services/affectProfile');

const router = Router();

router.use(authenticate);

// POST /api/v1/analysis/me — trigger preference analysis for current user
async function analysisResponse(userId) {
  const [result, preferenceAxes, affectProfile] = await Promise.all([
    analyzeUser(userId),
    getPreferenceAxes(userId),
    getAffectProfile(userId),
  ]);
  return {
    dimensions: DIMENSIONS,
    vector: result.vector,
    tags: result.tags,
    classification: result.classification,
    subtypes: result.subtypes,
    preference: {
      dimensions: DIMENSIONS,
      vector: result.vector,
      tags: result.tags,
      classification: result.classification,
    },
    preferenceAxes,
    affectProfile,
    experimental: { subtypes: result.subtypes },
  };
}

router.post('/me', async (req, res, next) => {
  try {
    res.json({ ok: true, data: await analysisResponse(req.user.id) });
  } catch (err) {
    next(err);
  }
});

router.get('/me', async (req, res, next) => {
  try {
    res.json({ ok: true, data: await analysisResponse(req.user.id) });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/analysis/dimensions — list preference dimensions
router.get('/dimensions', (_req, res) => {
  res.json({
    ok: true,
    data: DIMENSIONS.map((name, index) => ({
      index,
      name,
      pattern: name.split('_')[0],
    })),
  });
});

// GET /api/v1/analysis/schema — full classification schema reference
router.get('/schema', (_req, res) => {
  res.json({
    ok: true,
    data: {
      patterns: CLASSIFICATION_SCHEMA,
      gamerTypes: GAMER_TYPES,
      mechanicsTypes: MECHANICS_TYPES,
      storyTypes: STORY_TYPES,
    },
  });
});

module.exports = router;
