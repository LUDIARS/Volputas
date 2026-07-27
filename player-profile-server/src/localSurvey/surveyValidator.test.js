'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { QUESTIONS } = require('../../scripts/data/gamer-survey-questions');
const {
  MAX_FREETEXT_LENGTH,
  SurveyAnswerValidationError,
  validateSurveyAnswers,
} = require('./surveyValidator');

function makeValidAnswers() {
  return Object.fromEntries(QUESTIONS.map((question) => [
    question.id,
    question.type === 'choice'
      ? question.options[0].value
      : 'Slay the Spire\nInto the Breach',
  ]));
}

function assertValidationIssue(action, code, questionId) {
  assert.throws(action, (error) => {
    assert.equal(error instanceof SurveyAnswerValidationError, true);
    assert.equal(error.issues.some((issue) => (
      issue.code === code && issue.questionId === questionId
    )), true);
    return true;
  });
}

test('validates every gamer survey answer and returns a definition-ordered copy', () => {
  const answers = makeValidAnswers();
  const reorderedAnswers = Object.fromEntries(Object.entries(answers).reverse());

  const validated = validateSurveyAnswers(reorderedAnswers);

  assert.deepEqual(validated, answers);
  assert.deepEqual(Object.keys(validated), QUESTIONS.map(({ id }) => id));
  assert.notEqual(validated, reorderedAnswers);
});

test('rejects missing and unknown gamer survey answers', () => {
  const missing = makeValidAnswers();
  delete missing[QUESTIONS[0].id];
  assertValidationIssue(
    () => validateSurveyAnswers(missing),
    'missing_answer',
    QUESTIONS[0].id
  );

  const unknown = { ...makeValidAnswers(), 'retired-question': 'agree' };
  assertValidationIssue(
    () => validateSurveyAnswers(unknown),
    'unknown_answer',
    undefined
  );
});

test('does not echo an unknown answer key in validation diagnostics', () => {
  const sensitiveKey = 'my-secret-answer-text';
  const answers = { ...makeValidAnswers(), [sensitiveKey]: 'value' };

  assert.throws(
    () => validateSurveyAnswers(answers),
    (error) => {
      assert.equal(error.issues[0].code, 'unknown_answer');
      assert.equal(error.issues[0].count, 1);
      assert.doesNotMatch(error.message, new RegExp(sensitiveKey));
      return true;
    }
  );
});

test('rejects prototype-shaped keys without changing the answer prototype', () => {
  const answers = Object.assign(Object.create(null), makeValidAnswers());
  Object.defineProperty(answers, '__proto__', {
    enumerable: true,
    value: 'caller-controlled',
  });

  assertValidationIssue(
    () => validateSurveyAnswers(answers),
    'unknown_answer',
    undefined
  );
  assert.equal(Object.getPrototypeOf(answers), null);
});

test('rejects choice answers outside the declared string values', () => {
  const question = QUESTIONS.find(({ type }) => type === 'choice');

  const unknownChoice = makeValidAnswers();
  unknownChoice[question.id] = 'not-an-option';
  assertValidationIssue(
    () => validateSurveyAnswers(unknownChoice),
    'invalid_choice',
    question.id
  );

  const nonStringChoice = makeValidAnswers();
  nonStringChoice[question.id] = 1;
  assertValidationIssue(
    () => validateSurveyAnswers(nonStringChoice),
    'invalid_choice',
    question.id
  );
});

test('rejects missing, non-string, oversized, and unsafe freetext', async (t) => {
  const question = QUESTIONS.find(({ type }) => type === 'freetext');
  const cases = [
    { name: 'blank', value: ' \n\t ', code: 'missing_answer' },
    { name: 'non-string', value: ['game'], code: 'freetext_not_string' },
    {
      name: 'oversized',
      value: '遊'.repeat(MAX_FREETEXT_LENGTH + 1),
      code: 'freetext_too_long',
    },
    { name: 'control character', value: 'safe\u0000unsafe', code: 'unsafe_freetext' },
    { name: 'unpaired surrogate', value: 'safe\uD800unsafe', code: 'unsafe_freetext' },
  ];

  for (const { name, value, code } of cases) {
    await t.test(name, () => {
      const answers = makeValidAnswers();
      answers[question.id] = value;
      assertValidationIssue(
        () => validateSurveyAnswers(answers),
        code,
        question.id
      );
    });
  }
});

test('accepts safe multiline Markdown-looking freetext at the length boundary', () => {
  const question = QUESTIONS.find(({ type }) => type === 'freetext');
  const answers = makeValidAnswers();
  const suffix = '\n---\n```json\n# still data';
  answers[question.id] = `${'x'.repeat(MAX_FREETEXT_LENGTH - Array.from(suffix).length)}${suffix}`;

  const validated = validateSurveyAnswers(answers);

  assert.equal(validated[question.id], answers[question.id]);
  assert.equal(Array.from(validated[question.id]).length, MAX_FREETEXT_LENGTH);
});
