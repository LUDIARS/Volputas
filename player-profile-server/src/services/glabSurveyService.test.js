const test = require('node:test');
const assert = require('node:assert/strict');
const { AppError } = require('../middleware/errorHandler');
const {
  POSTGRES_INTEGER_MAX,
  POSTGRES_INTEGER_MIN,
  normalizeSurvey,
  validateAnswers,
  validateCategory,
  validateSurveyId,
} = require('../corpus/surveyContract');
const {
  createGlabSurveyService,
} = require('./glabSurveyService');

const USER_ID = '66e242b5-2f18-4463-b7f0-c0f12d818a20';
const SURVEY_ID = 'd2c6aca2-e754-4e4a-9f2b-270c85b989e5';
const GAME_ID = '3f1a2b4c-5d6e-4f70-8192-a3b4c5d6e7f8';
const CREATED_AT = new Date('2026-07-24T00:00:00.000Z');

const questions = [
  {
    id: 'rating',
    text: 'Rating',
    type: 'scale',
    required: true,
    options: { min: 1, max: 5 },
  },
  {
    id: 'genre',
    text: 'Genre',
    type: 'choice',
    required: false,
    options: { choices: ['RPG', 'Action'] },
  },
  {
    id: 'comment',
    text: 'Comment',
    type: 'freetext',
    required: false,
  },
];

function surveyRow(overrides = {}) {
  return {
    id: SURVEY_ID,
    title: 'Test survey',
    description: null,
    questions,
    category: 'game_review',
    created_at: CREATED_AT,
    ...overrides,
  };
}

function harness({ existingResponse = null, game = { id: GAME_ID } } = {}) {
  const calls = [];
  const surveyRepository = {
    async findForGlab(category) {
      calls.push(['list', category]);
      return [surveyRow()];
    },
    async findForGlabById(id) {
      calls.push(['detail', id]);
      return id === SURVEY_ID ? surveyRow() : null;
    },
    async createManaged(definition) {
      calls.push(['create', definition]);
      return surveyRow({
        game_id: definition.gameId ?? null,
        visible_to_glab: definition.visibleToGlab,
        is_active: definition.isActive,
      });
    },
    async updateManaged(id, patch) {
      calls.push(['update', id, patch]);
      if (id !== SURVEY_ID) return null;
      return surveyRow({
        game_id: patch.gameId ?? null,
        visible_to_glab: patch.visibleToGlab ?? false,
        is_active: patch.isActive ?? true,
      });
    },
  };
  const gameRepository = {
    async findById(id) {
      calls.push(['game', id]);
      return game;
    },
  };
  const responseStore = {
    async listStatuses(userId, surveyIds) {
      calls.push(['statuses', userId, surveyIds]);
      return { answeredSurveyIds: existingResponse ? [SURVEY_ID] : [] };
    },
    async getResponse(userId, surveyId) {
      calls.push(['response', userId, surveyId]);
      return existingResponse;
    },
    async saveResponse(value) {
      calls.push(['save', value]);
      return {
        surveyId: value.surveyId,
        answers: value.answers,
        submittedAt: '2026-07-24T01:00:00.000Z',
      };
    },
    close() {
      calls.push(['close']);
    },
  };
  return {
    calls,
    service: createGlabSurveyService({ surveyRepository, gameRepository, responseStore }),
  };
}

test('lists Corpus surveys with Cernere answered state', async () => {
  const { service, calls } = harness();
  const result = await service.listSurveys(USER_ID, 'game_review');

  assert.equal(result.length, 1);
  assert.equal(result[0].answered, false);
  assert.equal(result[0].createdAt, CREATED_AT.toISOString());
  assert.deepEqual(calls[0], ['list', 'game_review']);
  assert.deepEqual(calls[1], ['statuses', USER_ID, [SURVEY_ID]]);
});

test('loads and updates the current Cernere user response', async () => {
  const existingResponse = {
    surveyId: SURVEY_ID,
    answers: [{ questionId: 'rating', intValue: 3 }],
    submittedAt: '2026-07-24T00:30:00.000Z',
  };
  const { service, calls } = harness({ existingResponse });

  const detail = await service.getSurvey(USER_ID, SURVEY_ID);
  assert.equal(detail.survey.answered, true);
  assert.deepEqual(detail.response.answers, { rating: 3 });

  const saved = await service.saveResponse(USER_ID, SURVEY_ID, {
    rating: 5,
    genre: 'RPG',
    comment: 'answer-canary',
  });
  assert.equal(saved.survey.answered, true);
  assert.deepEqual(saved.response.answers, {
    rating: 5,
    genre: 'RPG',
    comment: 'answer-canary',
  });
  const saveCall = calls.find(([name]) => name === 'save');
  assert.deepEqual(saveCall[1].answers, [
    { questionId: 'rating', intValue: 5 },
    { questionId: 'genre', textValue: 'RPG' },
    { questionId: 'comment', textValue: 'answer-canary' },
  ]);
});

test('rejects invalid category and answers without including answer values', () => {
  assert.throws(
    () => validateCategory('medical_assessment'),
    (error) => error instanceof AppError
      && error.code === 'INVALID_SURVEY_CATEGORY'
      && error.statusCode === 400,
  );

  for (const answers of [
    {},
    { rating: 7 },
    { rating: 3, genre: 'answer-canary-secret' },
    { rating: 3, comment: 'answer-canary-secret\u0000' },
    { rating: 3, comment: 'answer-canary-secret\uD800' },
    { rating: 3, unknown: 'answer-canary-secret' },
    { rating: 3, 'answer-canary-secret': 'value' },
  ]) {
    assert.throws(
      () => validateAnswers(questions, answers),
      (error) => {
        assert.equal(error.code, 'INVALID_SURVEY_RESPONSE');
        assert.doesNotMatch(error.message, /answer-canary-secret/);
        return true;
      },
    );
  }
});

test('rejects an invalid survey path parameter as a client error', () => {
  assert.throws(
    () => validateSurveyId('not-a-uuid'),
    (error) => error.code === 'INVALID_SURVEY_ID'
      && error.statusCode === 400,
  );
});

test('creates a game-linked survey unpublished after checking the game exists', async () => {
  const { service, calls } = harness();
  const survey = await service.createSurvey({
    title: 'Uni Quest survey',
    questions,
    gameId: GAME_ID,
  });

  assert.equal(survey.gameId, GAME_ID);
  assert.equal(survey.visibleToGlab, false);
  assert.equal(survey.isActive, true);
  assert.deepEqual(calls.slice(0, 2).map(([name]) => name), ['game', 'create']);
});

test('refuses a survey linked to a missing game before writing it', async () => {
  const { service, calls } = harness({ game: null });

  await assert.rejects(
    () => service.createSurvey({ title: 'Unknown game survey', questions, gameId: GAME_ID }),
    (error) => error.code === 'GAME_NOT_FOUND' && error.statusCode === 400,
  );
  assert.equal(calls.some(([name]) => name === 'create'), false);
});

test('enforces freetext boundaries and omits optional empty answers', () => {
  assert.deepEqual(validateAnswers(questions, {
    rating: 1,
    genre: '',
    comment: 'x'.repeat(4_000),
  }), [
    { questionId: 'rating', intValue: 1 },
    { questionId: 'comment', textValue: 'x'.repeat(4_000) },
  ]);
  assert.throws(
    () => validateAnswers(questions, {
      rating: 1,
      comment: 'x'.repeat(4_001),
    }),
    /Invalid text answer: comment/,
  );
  assert.deepEqual(validateAnswers(questions, {
    rating: 1,
    comment: 'paired surrogate 😀',
  }), [
    { questionId: 'rating', intValue: 1 },
    { questionId: 'comment', textValue: 'paired surrogate 😀' },
  ]);
});

test('keeps scale definitions and answers within PostgreSQL INTEGER bounds', () => {
  const integerScale = [{
    id: 'wide_rating',
    text: 'Wide rating',
    type: 'scale',
    required: true,
    options: {
      min: POSTGRES_INTEGER_MIN,
      max: POSTGRES_INTEGER_MAX,
    },
  }];

  assert.deepEqual(
    validateAnswers(integerScale, { wide_rating: POSTGRES_INTEGER_MAX }),
    [{ questionId: 'wide_rating', intValue: POSTGRES_INTEGER_MAX }],
  );
  assert.throws(
    () => validateAnswers(integerScale, {
      wide_rating: POSTGRES_INTEGER_MAX + 1,
    }),
    /Invalid scale answer/,
  );
  assert.throws(
    () => validateAnswers(integerScale, {
      wide_rating: POSTGRES_INTEGER_MIN - 1,
    }),
    /Invalid scale answer/,
  );
  assert.throws(
    () => normalizeSurvey(surveyRow({
      questions: [{
        ...integerScale[0],
        options: {
          min: POSTGRES_INTEGER_MIN,
          max: POSTGRES_INTEGER_MAX + 1,
        },
      }],
    })),
    (error) => error.code === 'INVALID_SURVEY_DEFINITION',
  );
});

test('fails closed when a stored survey definition is invalid', () => {
  assert.throws(
    () => normalizeSurvey(surveyRow({
      questions: [...questions, questions[0]],
    })),
    (error) => error.code === 'INVALID_SURVEY_DEFINITION'
      && error.statusCode === 500,
  );
});

test('rejects a Cernere response for another or unknown survey question', async () => {
  for (const existingResponse of [
    {
      surveyId: '3e3794ea-6c3c-46cb-87eb-28264f4ae24c',
      answers: [{ questionId: 'rating', intValue: 3 }],
      submittedAt: '2026-07-24T00:30:00.000Z',
    },
    {
      surveyId: SURVEY_ID,
      answers: [{ questionId: 'other-survey-secret', textValue: 'answer-canary' }],
      submittedAt: '2026-07-24T00:30:00.000Z',
    },
  ]) {
    const { service } = harness({ existingResponse });
    await assert.rejects(
      service.getSurvey(USER_ID, SURVEY_ID),
      (error) => error.code === 'CERNERE_UPSTREAM_ERROR'
        && error.statusCode === 502
        && !error.message.includes('answer-canary'),
    );
  }
});

test('closes the shared Cernere response store', () => {
  const { service, calls } = harness();
  service.close();
  assert.deepEqual(calls.at(-1), ['close']);
});
