const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { analyzeUser, DIMENSIONS } = require('../services/analysisEngine');

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
    data: DIMENSIONS.map((name, index) => ({ index, name })),
  });
});

module.exports = router;
