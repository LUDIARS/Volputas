'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SURVEY_ID,
  SURVEY_VERSION,
  SURVEY_TITLE,
  SURVEY_DESCRIPTION,
  QUESTIONS,
} = require('../surveys/gamerPreferencesSurvey');
const {
  SurveyAnswerValidationError,
} = require('./surveyValidator');
const { renderSurveyResponseOkf } = require('./surveyResponseOkf');

const DEFINITION = {
  id: SURVEY_ID,
  version: SURVEY_VERSION,
  title: SURVEY_TITLE,
  description: SURVEY_DESCRIPTION,
  questions: QUESTIONS,
};

function makeValidAnswers() {
  return Object.fromEntries(QUESTIONS.map((question) => [
    question.id,
    question.type === 'choice' ? question.options.at(-1).value : 'Portal 2',
  ]));
}

function extractAuthoritativeJson(document) {
  const lines = document.trimEnd().split('\n');
  const openingIndex = lines.findIndex((line) => /^`{3,}json$/.test(line));
  assert.notEqual(openingIndex, -1);
  const fence = lines[openingIndex].slice(0, -4);
  const closingIndex = lines.indexOf(fence, openingIndex + 1);
  assert.notEqual(closingIndex, -1);
  return {
    fence,
    value: JSON.parse(lines.slice(openingIndex + 1, closingIndex).join('\n')),
  };
}

test('renders a deterministic response with stable GitHub identity and validated answers', () => {
  const answers = makeValidAnswers();
  answers['favorite-titles'] = [
    'Slay the Spire',
    '---',
    '```json',
    '{"pretend": "document"}',
    '```````',
    '# still answer text',
  ].join('\n');
  const input = {
    definition: DEFINITION,
    answers,
    identity: { login: 'neco-player', id: 12345678 },
    timestamp: '2026-07-23T21:15:00+09:00',
    producerRevision: 'ABCDEF0123456789ABCDEF0123456789ABCDEF01',
  };

  const document = renderSurveyResponseOkf(input);
  const reorderedInput = {
    ...input,
    answers: Object.fromEntries(Object.entries(answers).reverse()),
    identity: { id: '12345678', login: 'neco-player' },
  };

  assert.equal(document, renderSurveyResponseOkf(reorderedInput));
  assert.match(document, /^---\ntype: "Survey Response"\n/);
  assert.match(document, /\ntimestamp: "2026-07-23T12:15:00\.000Z"\n/);
  assert.match(document, /\ngithub_user_id: "12345678"\n/);
  assert.match(document, /\ngithub_login: "neco-player"\n/);
  assert.match(
    document,
    /Validated against the \[survey definition\]\(\/surveys\/gamer-preferences\.md\)\./
  );

  const { fence, value } = extractAuthoritativeJson(document);
  assert.equal(fence.length, 8);
  assert.equal(value.kind, 'voluptas.survey_response');
  assert.equal(value.okf_version, '0.1');
  assert.equal(value.survey_id, SURVEY_ID);
  assert.equal(value.survey_version, SURVEY_VERSION);
  assert.equal(value.survey_definition, '/surveys/gamer-preferences.md');
  assert.deepEqual(value.github_identity, {
    id: '12345678',
    login: 'neco-player',
  });
  assert.equal(value.submitted_at, '2026-07-23T12:15:00.000Z');
  assert.equal(
    value.producer_revision,
    'abcdef0123456789abcdef0123456789abcdef01'
  );
  assert.deepEqual(value.answers, answers);
});

test('response rendering rejects answers that do not match the supplied definition', () => {
  const answers = makeValidAnswers();
  delete answers[QUESTIONS[0].id];

  assert.throws(
    () => renderSurveyResponseOkf({
      definition: DEFINITION,
      answers,
      identity: { login: 'neco-player', id: 12345678 },
      timestamp: '2026-07-23T12:15:00.000Z',
      producerRevision: 'abcdef0123456789abcdef0123456789abcdef01',
    }),
    SurveyAnswerValidationError
  );
});

test('response rendering rejects invalid identity, timestamp, and producer revision metadata', () => {
  const baseInput = {
    definition: DEFINITION,
    answers: makeValidAnswers(),
    identity: { login: 'neco-player', id: 12345678 },
    timestamp: '2026-07-23T12:15:00.000Z',
    producerRevision: 'abcdef0123456789abcdef0123456789abcdef01',
  };

  assert.throws(
    () => renderSurveyResponseOkf({
      ...baseInput,
      identity: { login: '../player', id: 12345678 },
    }),
    /GitHub login is invalid/
  );
  assert.throws(
    () => renderSurveyResponseOkf({ ...baseInput, timestamp: '2026-07-23' }),
    /must include an ISO 8601 time zone/
  );
  assert.throws(
    () => renderSurveyResponseOkf({ ...baseInput, producerRevision: 'dirty' }),
    /must be a Git commit id/
  );
});
