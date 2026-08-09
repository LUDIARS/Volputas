const surveyModel = require('../models/surveyModel');
const gameModel = require('../models/gameModel');
const { AppError } = require('../middleware/errorHandler');
const {
  CernereIntegrationError,
} = require('../integrations/cernere/cernereErrors');
const { validateOptionalGameId } = require('../corpus/gameContract');
const {
  validateSurveyDefinition,
  validateSurveyDefinitionUpdate,
} = require('../corpus/surveyDefinitionContract');
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

// 管理者へ返す形。 学生向けの surveyView と違い answered を持たず、 代わりに
// 公開状態を返す (未公開のまま作って内容を確認してから公開する運用のため)。
function managedView(row) {
  // normalizeSurvey の行スキーマは .strict() なので、 公開フラグは定義本体から
  // 外してから通す。
  const { visible_to_glab: visibleToGlab, is_active: isActive, ...definition } = row;
  return { ...normalizeSurvey(definition), visibleToGlab, isActive };
}

/** @implements SPEC-GLAB-SURVEY-CATALOG */
function createGlabSurveyService({
  surveyRepository = surveyModel,
  gameRepository = gameModel,
  responseStore = createVolputasSurveyResponseStore(),
} = {}) {
  // 紐付け先を確かめずに保存すると、 FK 違反が 500 になるか、 ゲームを消した
  // 後の SET NULL で「どのゲームのアンケートか分からない」行が残る。
  async function assertGameExists(gameId) {
    if (!gameId) return;
    const game = await gameRepository.findById(gameId);
    if (!game) throw new AppError(400, 'GAME_NOT_FOUND', 'The referenced game does not exist');
  }

  return {
    async listSurveys(userIdValue, categoryValue, gameIdValue) {
      const userId = validateUserId(userIdValue);
      const category = validateCategory(categoryValue);
      const gameId = validateOptionalGameId(gameIdValue);
      const surveys = (await surveyRepository.findForGlab(category, gameId)).map(normalizeSurvey);
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

    // --- 管理者操作 (routes 側で requireCernereAdmin を通した後にだけ呼ばれる) ---

    async createSurvey(body) {
      const definition = validateSurveyDefinition(body);
      await assertGameExists(definition.gameId);
      const row = await surveyRepository.createManaged(definition);
      return managedView(row);
    },

    async updateSurvey(surveyIdValue, body) {
      const surveyId = validateSurveyId(surveyIdValue);
      const patch = validateSurveyDefinitionUpdate(body);
      if (Object.hasOwn(patch, 'gameId')) await assertGameExists(patch.gameId);
      const row = await surveyRepository.updateManaged(surveyId, patch);
      return row ? managedView(row) : null;
    },

    close() {
      return responseStore.close();
    },
  };
}

module.exports = {
  createGlabSurveyService,
};
