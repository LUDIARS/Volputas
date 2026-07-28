'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { SURVEY_DEFINITIONS, findSurveyDefinition } = require('./surveyCatalog');
const { AGREE_SCORING } = require('./agreementScale');
const gamerPreferences = require('./gamerPreferencesSurvey');
const gamerSubtypes = require('./gamerSubtypesSurvey');
const gamerEmotions = require('./gamerEmotionsSurvey');
const { PREFERENCE_AXES } = require('../services/preferenceAxisDefinitions');
const { DIMENSIONS, GAMER_SUBTYPE_KEYS } = require('../services/hobbyPatternDefinitions');
const { SURVEY_DIMENSION_MAP } = require('../services/analysisEngine');

// Voluptas-native question ids also have to satisfy the stricter Corpus contract pattern
// (src/corpus/surveyContract.js) so a definition never becomes un-publishable purely because of
// its ids — note it forbids the dots that the local validator would allow.
const CORPUS_QUESTION_ID_PATTERN = /^[a-z][a-z0-9_-]{0,99}$/;

function allQuestions() {
  return SURVEY_DEFINITIONS.flatMap((entry) => entry.definition.QUESTIONS);
}

test('catalog exposes the three split surveys', () => {
  assert.deepEqual(
    SURVEY_DEFINITIONS.map((entry) => entry.definition.SURVEY_ID),
    ['gamer-preferences', 'gamer-subtypes', 'gamer-emotions']
  );
  assert.equal(findSurveyDefinition('gamer-subtypes').definition, gamerSubtypes);
  assert.equal(findSurveyDefinition('missing'), null);
});

test('survey ids and titles are unique', () => {
  const ids = SURVEY_DEFINITIONS.map((entry) => entry.definition.SURVEY_ID);
  const titles = SURVEY_DEFINITIONS.map((entry) => entry.definition.SURVEY_TITLE);
  assert.equal(new Set(ids).size, ids.length);
  // seed-surveys.js upserts by title, so a duplicate title would silently overwrite a survey.
  assert.equal(new Set(titles).size, titles.length);
});

test('question ids are globally unique and Corpus-contract safe', () => {
  const ids = allQuestions().map((question) => question.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) {
    assert.match(id, CORPUS_QUESTION_ID_PATTERN);
  }
});

test('every scored question carries the shared agreement scale', () => {
  const scored = allQuestions().filter(
    (question) => question.dimension || question.axis || question.subtype
  );
  assert.ok(scored.length > 0);
  for (const question of scored) {
    assert.equal(question.type, 'choice');
    assert.deepEqual(question.scoring, AGREE_SCORING);
    const values = question.options.map((option) => option.value);
    assert.deepEqual(values.slice().sort(), Object.keys(AGREE_SCORING).slice().sort());
  }
});

test('core survey covers all 12 dimensions and all 15 preference axes', () => {
  const covered = new Set(
    gamerPreferences.QUESTIONS
      .filter((question) => question.dimension)
      .map((question) => SURVEY_DIMENSION_MAP[question.dimension])
  );
  for (const dimension of DIMENSIONS) {
    assert.ok(covered.has(dimension), `no question targets dimension ${dimension}`);
  }

  const axes = new Set(gamerPreferences.QUESTIONS.map((question) => question.axis));
  for (const axis of PREFERENCE_AXES) {
    assert.ok(axes.has(axis), `no question targets axis ${axis}`);
  }
});

test('subtype survey covers all 20 gamer subtypes exactly once', () => {
  const subtypes = gamerSubtypes.QUESTIONS.map((question) => question.subtype);
  assert.equal(subtypes.length, GAMER_SUBTYPE_KEYS.length);
  assert.deepEqual(subtypes.slice().sort(), GAMER_SUBTYPE_KEYS.slice().sort());
});

test('emotion survey is freetext-only with positive affect weights', () => {
  assert.ok(gamerEmotions.QUESTIONS.length > 0);
  for (const question of gamerEmotions.QUESTIONS) {
    assert.equal(question.type, 'freetext');
    assert.ok(question.weight > 0, `${question.id} has no affect weight`);
    assert.ok(question.weight <= gamerEmotions.EMOTION_MAX_WEIGHT);
  }
});

test('title list is down-weighted below every emotion question', () => {
  const titles = gamerPreferences.QUESTIONS.find((question) => question.id === 'favorite-titles');
  const minEmotionWeight = Math.min(...gamerEmotions.QUESTIONS.map((question) => question.weight));
  assert.ok(titles.weight < minEmotionWeight);
});

test('native surveys stay out of the GLAB catalog until the contract shapes are reconciled', () => {
  // The Corpus contract parses stored rows with a .strict() schema, so publishing these
  // definitions as-is would fail with INVALID_SURVEY_DEFINITION rather than degrade.
  for (const entry of SURVEY_DEFINITIONS) {
    assert.equal(entry.visibleToGlab, false);
    assert.equal(entry.category, 'game_survey');
  }
});
