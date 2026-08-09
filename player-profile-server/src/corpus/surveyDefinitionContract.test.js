const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateSurveyDefinition,
  validateSurveyDefinitionUpdate,
} = require('./surveyDefinitionContract');
const { normalizeSurvey } = require('./surveyContract');

const GAME_ID = '3f1a2b4c-5d6e-4f70-8192-a3b4c5d6e7f8';

function definition(overrides = {}) {
  return {
    title: 'Uni Quest の感想',
    questions: [
      { id: 'overall', text: '総合評価', type: 'scale', options: { min: 1, max: 5 } },
      { id: 'best_part', text: '一番良かった場面', type: 'freetext' },
    ],
    ...overrides,
  };
}

test('a new survey starts unpublished so it can be reviewed first', () => {
  const parsed = validateSurveyDefinition(definition());

  assert.equal(parsed.visibleToGlab, false);
  assert.equal(parsed.isActive, true);
  assert.equal(parsed.category, 'game_survey');
});

test('an admin-authored definition passes the read-side contract', () => {
  const parsed = validateSurveyDefinition(definition({ gameId: GAME_ID }));

  // 保存後に読み出し側 (surveyContract) が 500 を出さないことが、 この入力
  // 契約を別に置いている理由そのもの。
  const view = normalizeSurvey({
    id: '9a5c8f52-1d3e-4b6a-8c7d-0e1f2a3b4c5d',
    title: parsed.title,
    description: parsed.description,
    questions: parsed.questions,
    category: parsed.category,
    game_id: parsed.gameId,
    created_at: '2026-08-09T00:00:00.000Z',
  });

  assert.equal(view.gameId, GAME_ID);
  assert.equal(view.questions.length, 2);
});

test('question ids must be unique', () => {
  assert.throws(
    () => validateSurveyDefinition(definition({
      questions: [
        { id: 'overall', text: 'A', type: 'freetext' },
        { id: 'overall', text: 'B', type: 'freetext' },
      ],
    })),
    (error) => error.code === 'INVALID_SURVEY_DEFINITION_INPUT',
  );
});

test('database-unsafe Unicode is rejected before persistence', () => {
  assert.throws(
    () => validateSurveyDefinition(definition({ title: 'unsafe\u0000title' })),
    (error) => error.code === 'INVALID_SURVEY_DEFINITION_INPUT',
  );
  assert.throws(
    () => validateSurveyDefinition(definition({
      questions: [{ id: 'comment', text: 'unsafe\uD800text', type: 'freetext' }],
    })),
    (error) => error.code === 'INVALID_SURVEY_DEFINITION_INPUT',
  );
});

test('a choice question needs choices in the contract shape', () => {
  assert.throws(
    () => validateSurveyDefinition(definition({
      questions: [{ id: 'genre', text: 'ジャンル', type: 'choice', options: { choices: [] } }],
    })),
    (error) => error.code === 'INVALID_SURVEY_DEFINITION_INPUT',
  );

  // Voluptas 自前アンケートの形 (options: [{value,label}]) は catalog 契約と
  // 非互換。 保存前にここで弾く。
  assert.throws(
    () => validateSurveyDefinition(definition({
      questions: [{
        id: 'genre',
        text: 'ジャンル',
        type: 'choice',
        options: [{ value: 'rpg', label: 'RPG' }],
      }],
    })),
    (error) => error.code === 'INVALID_SURVEY_DEFINITION_INPUT',
  );
});

test('a scale question with an inverted range is refused', () => {
  assert.throws(
    () => validateSurveyDefinition(definition({
      questions: [{ id: 'overall', text: 'X', type: 'scale', options: { min: 5, max: 1 } }],
    })),
    (error) => error.code === 'INVALID_SURVEY_DEFINITION_INPUT',
  );
});

test('an empty update is refused rather than reported as saved', () => {
  assert.throws(
    () => validateSurveyDefinitionUpdate({}),
    (error) => error.code === 'INVALID_SURVEY_DEFINITION_INPUT',
  );
});

test('publishing is expressible as a single-field update', () => {
  assert.deepEqual(validateSurveyDefinitionUpdate({ visibleToGlab: true }), {
    visibleToGlab: true,
  });
});

test('a survey can be detached from its game', () => {
  assert.deepEqual(validateSurveyDefinitionUpdate({ gameId: null }), { gameId: null });
});
