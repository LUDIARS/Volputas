'use strict';

function parseLocalSurveyArguments(argv) {
  const options = {
    answersPath: null,
    saveOnly: true,
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

module.exports = { parseLocalSurveyArguments };
