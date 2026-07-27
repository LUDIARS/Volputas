'use strict';

// Defaults to the core survey so the existing `npm run survey:local` invocation keeps answering
// the same questionnaire it always has; the subtype and emotion surveys are opt-in by id.
const DEFAULT_SURVEY_ID = 'gamer-preferences';

function parseLocalSurveyArguments(argv) {
  const options = {
    answersPath: null,
    saveOnly: true,
    surveyId: DEFAULT_SURVEY_ID,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--answers') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('--answers requires a path to a JSON file');
      }
      options.answersPath = value;
      index += 1;
    } else if (argument === '--survey') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('--survey requires a survey ID');
      }
      options.surveyId = value;
      index += 1;
    } else if (argument === '--save-only') {
      options.saveOnly = true;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown local survey option: ${argument}`);
    }
  }

  return Object.freeze(options);
}

module.exports = { DEFAULT_SURVEY_ID, parseLocalSurveyArguments };
