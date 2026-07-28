const surveyModel = require('../models/surveyModel');
const {
  CernereIntegrationError,
} = require('../integrations/cernere/cernereErrors');
const {
  createVolputasSurveyResponseStore,
} = require('../integrations/cernere/createVolputasSurveyResponseStore');
const {
  SurveyContractError,
  normalizeSurvey,
  responseView,
  surveyView,
  validateAnswers,
  validateCategory,
  validateSurveyId,
  validateUserId,
} = require('../corpus/surveyContract');

function projectResponse(survey, response) {
  try {
    return responseView(survey, response);
  } catch (error) {
    if (!(error instanceof SurveyContractError)) throw error;
    throw new CernereIntegrationError('Cernere returned an invalid survey response');
  }
}

function createGlabSurveyService({
  surveyRepository = surveyModel,
  responseStore = createVolputasSurveyResponseStore(),
} = {}) {
  return {
    async listSurveys(userIdValue, categoryValue) {
      const userId = validateUserId(userIdValue);
      const category = validateCategory(categoryValue);
      const surveys = (await surveyRepository.findForGlab(category)).map(normalizeSurvey);
      if (surveys.length === 0) return [];
      const status = await responseStore.listStatuses(
        userId,
        surveys.map((survey) => survey.id),
      );
      const answered = new Set(status.answeredSurveyIds);
      return surveys.map((survey) => surveyView(survey, answered.has(survey.id)));
    },

    async getSurvey(userIdValue, surveyIdValue) {
      const userId = validateUserId(userIdValue);
      const surveyId = validateSurveyId(surveyIdValue);
      const row = await surveyRepository.findForGlabById(surveyId);
      if (!row) return null;
      const survey = normalizeSurvey(row);
      const response = await responseStore.getResponse(userId, surveyId);
      return {
        survey: surveyView(survey, Boolean(response)),
        response: response ? projectResponse(survey, response) : null,
      };
    },

    async saveResponse(userIdValue, surveyIdValue, answersValue) {
      const userId = validateUserId(userIdValue);
      const surveyId = validateSurveyId(surveyIdValue);
      const row = await surveyRepository.findForGlabById(surveyId);
      if (!row) return null;
      const survey = normalizeSurvey(row);
      const answers = validateAnswers(survey.questions, answersValue);
      const response = await responseStore.saveResponse({
        userId,
        surveyId,
        answers,
      });
      return {
        survey: surveyView(survey, true),
        response: projectResponse(survey, response),
      };
    },

    close() {
      return responseStore.close();
    },
  };
}

module.exports = {
  createGlabSurveyService,
};
