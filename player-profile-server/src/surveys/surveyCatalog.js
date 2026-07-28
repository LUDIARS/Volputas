'use strict';

const gamerPreferences = require('./gamerPreferencesSurvey');
const gamerSubtypes = require('./gamerSubtypesSurvey');
const gamerEmotions = require('./gamerEmotionsSurvey');

// The Voluptas-native survey suite, split by what each survey measures rather than bundled
// into one long questionnaire:
//   gamer-preferences : 12 dimensions + 15 style axes (main type)
//   gamer-subtypes    : 20 gamer subtypes (narrows the main type)
//   gamer-emotions    : 20-dimension affect vector from narrative answers
// Adding a survey here is enough for scripts/seed-surveys.js to pick it up.
//
// `visibleToGlab` stays false for all of them. These definitions use the Voluptas-native
// question shape (`options: [{value,label}]` plus `dimension`/`axis`/`subtype`/`scoring`),
// while the Corpus/GLAB catalog contract (src/corpus/surveyContract.js) parses stored rows
// with a `.strict()` schema and `options: {choices:[…]}`. Flipping the flag without first
// reconciling the two shapes would make the catalog respond 500 INVALID_SURVEY_DEFINITION.
const SURVEY_CATEGORY_GAME_SURVEY = 'game_survey';

const SURVEY_DEFINITIONS = Object.freeze([
  Object.freeze({
    definition: gamerPreferences,
    category: SURVEY_CATEGORY_GAME_SURVEY,
    visibleToGlab: false,
  }),
  Object.freeze({
    definition: gamerSubtypes,
    category: SURVEY_CATEGORY_GAME_SURVEY,
    visibleToGlab: false,
  }),
  Object.freeze({
    definition: gamerEmotions,
    category: SURVEY_CATEGORY_GAME_SURVEY,
    visibleToGlab: false,
  }),
]);

function findSurveyDefinition(surveyId) {
  return SURVEY_DEFINITIONS.find((entry) => entry.definition.SURVEY_ID === surveyId) || null;
}

module.exports = {
  SURVEY_CATEGORY_GAME_SURVEY,
  SURVEY_DEFINITIONS,
  findSurveyDefinition,
};
