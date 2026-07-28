const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const surveyModel = require('../models/surveyModel');
const { AppError } = require('../middleware/errorHandler');
const { getProfileEvidenceStore } = require('../integrations/cernere/createProfileEvidenceStore');

const router = Router();
const responseStore = getProfileEvidenceStore();

function normalizedAnswers(survey, answers) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    throw new AppError(400, 'INVALID_SURVEY_ANSWERS', 'Survey answers must be an object');
  }
  return survey.questions.map((question) => {
    const value = answers[question.id];
    if (value === undefined || value === null || value === '') {
      throw new AppError(400, 'INCOMPLETE_SURVEY_RESPONSE', `Answer is required: ${question.text}`);
    }
    return Number.isInteger(value)
      ? { questionId: question.id, intValue: value }
      : { questionId: question.id, textValue: String(value) };
  });
}

function responseForFrontend(response) {
  if (!response) return null;
  return {
    survey_id: response.surveyId,
    answers: Object.fromEntries(response.answers.map((answer) => [
      answer.questionId,
      answer.textValue ?? answer.intValue,
    ])),
    submitted_at: response.submittedAt,
  };
}

router.use(authenticate);

// GET /api/v1/surveys — list active surveys
router.get('/', async (req, res, next) => {
  try {
    const surveys = await surveyModel.findActive();
    const status = await responseStore.listSurveyStatuses(
      req.user.id,
      surveys.map((survey) => survey.id)
    );
    const answered = new Set(status.answeredSurveyIds);
    res.json({
      ok: true,
      data: surveys.map((survey) => ({
        ...survey,
        category: { id: 'general', label: 'General', order: 100 },
        responseStatus: answered.has(survey.id) ? 'answered' : 'unanswered',
      })),
    });
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

    const response = await responseStore.saveSurveyResponse(
      req.user.id,
      req.params.id,
      normalizedAnswers(survey, req.body.answers)
    );
    res.status(201).json({ ok: true, data: responseForFrontend(response) });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/surveys/:id/responses/me — own response
router.get('/:id/responses/me', validate({
  params: { id: { required: true, type: 'uuid' } },
}), async (req, res, next) => {
  try {
    const response = await responseStore.getSurveyResponse(req.user.id, req.params.id);
    if (!response) {
      throw new AppError(404, 'NOT_FOUND', 'No response found');
    }
    res.json({ ok: true, data: responseForFrontend(response) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.normalizedAnswers = normalizedAnswers;
module.exports.responseForFrontend = responseForFrontend;
