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
const { renderSurveyDefinitionOkf } = require('./surveyDefinitionOkf');

function makeDefinition(overrides = {}) {
  return {
    id: SURVEY_ID,
    version: SURVEY_VERSION,
    title: SURVEY_TITLE,
    description: SURVEY_DESCRIPTION,
    questions: QUESTIONS,
    ...overrides,
  };
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

test('renders the gamer survey definition as deterministic OKF v0.1 Markdown', () => {
  const definition = makeDefinition();
  const reorderedDefinition = {
    questions: QUESTIONS.map((question) => (
      Object.fromEntries(Object.entries(question).reverse())
    )),
    description: SURVEY_DESCRIPTION,
    title: SURVEY_TITLE,
    version: SURVEY_VERSION,
    id: SURVEY_ID,
  };

  const document = renderSurveyDefinitionOkf(definition);

  assert.equal(document, renderSurveyDefinitionOkf(reorderedDefinition));
  assert.match(document, /^---\ntype: "Survey Definition"\n/);
  assert.match(document, /\nokf_version: "0\.1"\n/);
  assert.match(document, /\nsurvey_id: "gamer-preferences"\n/);
  assert.match(document, /\nsurvey_version: "1\.0\.0"\n/);
  assert.equal(document.endsWith('\n'), true);

  const { value } = extractAuthoritativeJson(document);
  assert.equal(value.kind, 'voluptas.survey_definition');
  assert.equal(value.okf_version, '0.1');
  assert.equal(value.survey_id, SURVEY_ID);
  assert.equal(value.survey_version, SURVEY_VERSION);
  assert.equal(value.title, SURVEY_TITLE);
  assert.equal(value.description, SURVEY_DESCRIPTION);
  assert.deepEqual(value.questions, QUESTIONS);
});

test('uses a longer JSON fence when definition content contains backtick runs', () => {
  const definition = makeDefinition({
    questions: [{
      id: 'fence-test',
      type: 'freetext',
      text: '``````',
    }],
  });

  const { fence, value } = extractAuthoritativeJson(
    renderSurveyDefinitionOkf(definition)
  );

  assert.equal(fence, '```````');
  assert.equal(value.questions[0].text, '``````');
});
