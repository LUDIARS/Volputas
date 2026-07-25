const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const surveyModel = require('../models/surveyModel');
const { AppError } = require('../middleware/errorHandler');
const { recomputePreferenceAxes } = require('../services/preferenceAxes');
const { recomputeAffectProfile } = require('../services/affectProfile');
const { analyzeUser } = require('../services/analysisEngine');

const router = Router();

router.use(authenticate);

// GET /api/v1/surveys — list active surveys
router.get('/', async (req, res, next) => {
  try {
    const surveys = await surveyModel.findActiveForUser(req.user.id);
    res.json({ ok: true, data: surveys });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/surveys/:id — survey detail
router.get('/:id', validate({
  params: { id: { required: true, type: 'uuid' } },
}), async (req, res, next) => {
  try {
    const survey = await surveyModel.findById(req.params.id);
    if (!survey) {
      throw new AppError(404, 'NOT_FOUND', 'Survey not found');
    }
    res.json({ ok: true, data: survey });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/surveys/:id/responses — submit response
router.post('/:id/responses', validate({
  params: { id: { required: true, type: 'uuid' } },
  body: { answers: { required: true, type: 'object' } },
}), async (req, res, next) => {
  try {
    const survey = await surveyModel.findById(req.params.id);
    if (!survey || !survey.is_active) {
      throw new AppError(404, 'NOT_FOUND', 'Survey not found or inactive');
    }

    const response = await surveyModel.submitResponse({
      surveyId: req.params.id,
      userId: req.user.id,
      answers: req.body.answers,
    });

    await Promise.all([
      recomputePreferenceAxes(req.user.id),
      recomputeAffectProfile(req.user.id),
      analyzeUser(req.user.id),
    ]);

    res.status(201).json({ ok: true, data: response });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/surveys/:id/responses/me — own response
router.get('/:id/responses/me', validate({
  params: { id: { required: true, type: 'uuid' } },
}), async (req, res, next) => {
  try {
    const response = await surveyModel.findUserResponse(req.params.id, req.user.id);
    if (!response) {
      throw new AppError(404, 'NOT_FOUND', 'No response found');
    }
    res.json({ ok: true, data: response });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
