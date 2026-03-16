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

const router = Router();

router.use(authenticate);

// POST /api/v1/analysis/me — trigger preference analysis for current user
router.post('/me', async (req, res, next) => {
  try {
    const result = await analyzeUser(req.user.id);
    res.json({
      ok: true,
      data: {
        dimensions: DIMENSIONS,
        vector: result.vector,
        tags: result.tags,
        classification: result.classification,
        subtypes: result.subtypes,
      },
    });
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
