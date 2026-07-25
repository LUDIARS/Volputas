const fs = require('node:fs/promises');
const path = require('node:path');
const { GAMER_SURVEY } = require('./surveyCatalog');

const SURVEY_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SUPPORTED_QUESTION_TYPES = new Set(['choice', 'scale', 'freetext']);

function validateSurveyDefinition(value, source = 'survey definition') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Object.assign(new Error(`${source} must be an object`), {
      code: 'INVALID_SURVEY_DEFINITION',
    });
  }
  if (typeof value.id !== 'string' || !SURVEY_ID_PATTERN.test(value.id)) {
    throw Object.assign(new Error(`${source} has an invalid id`), {
      code: 'INVALID_SURVEY_DEFINITION',
    });
  }
  if (typeof value.title !== 'string' || !value.title.trim()) {
    throw Object.assign(new Error(`${source} has no title`), {
      code: 'INVALID_SURVEY_DEFINITION',
    });
  }
  if (!Array.isArray(value.questions) || value.questions.length === 0) {
    throw Object.assign(new Error(`${source} has no questions`), {
      code: 'INVALID_SURVEY_DEFINITION',
    });
  }

  const questionIds = new Set();
  for (const question of value.questions) {
    if (
      !question
      || typeof question.id !== 'string'
      || !question.id
      || questionIds.has(question.id)
      || !SUPPORTED_QUESTION_TYPES.has(question.type)
      || typeof question.text !== 'string'
      || !question.text.trim()
    ) {
      throw Object.assign(new Error(`${source} contains an invalid question`), {
        code: 'INVALID_SURVEY_DEFINITION',
      });
    }
    questionIds.add(question.id);

    if (question.type === 'choice') {
      const hasValidOptions = Array.isArray(question.options)
        && question.options.length > 0
        && question.options.every((option) => {
          if (typeof option === 'string') return option.length > 0;
          return option
            && typeof option === 'object'
            && typeof option.value === 'string'
            && option.value.length > 0
            && typeof option.label === 'string'
            && option.label.length > 0;
        });
      if (!hasValidOptions) {
        throw Object.assign(new Error(`${source} contains a choice question without valid options`), {
          code: 'INVALID_SURVEY_DEFINITION',
        });
      }
    }
    if (question.type === 'scale') {
      const minimum = question.options?.min ?? 1;
      const maximum = question.options?.max ?? 5;
      if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum >= maximum) {
        throw Object.assign(new Error(`${source} contains an invalid scale range`), {
          code: 'INVALID_SURVEY_DEFINITION',
        });
      }
    }
  }
  return value;
}

class SurveyDefinitionStore {
  async ensureDefault(repositoryRoot) {
    const directory = path.join(path.resolve(repositoryRoot), 'surveys');
    const filePath = path.join(directory, `${GAMER_SURVEY.id}.json`);
    await fs.mkdir(directory, { recursive: true });

    try {
      await fs.writeFile(filePath, `${JSON.stringify(GAMER_SURVEY, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
      });
      return { action: 'created', filePath };
    } catch (error) {
      if (error.code === 'EEXIST') return { action: 'preserved', filePath };
      throw error;
    }
  }

  async list(repositoryRoot) {
    const directory = path.join(path.resolve(repositoryRoot), 'surveys');
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw Object.assign(new Error(`Survey directory does not exist: ${directory}`), {
          code: 'SURVEY_DATA_MISSING',
        });
      }
      throw error;
    }

    const fileNames = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name)
      .sort();
    if (fileNames.length === 0) {
      throw Object.assign(new Error(`No survey JSON files found in: ${directory}`), {
        code: 'SURVEY_DATA_MISSING',
      });
    }

    return Promise.all(
      fileNames.map((fileName) => this.#readFile(path.join(directory, fileName)))
    );
  }

  async find(repositoryRoot, surveyId) {
    if (!SURVEY_ID_PATTERN.test(surveyId)) return null;
    const filePath = path.join(path.resolve(repositoryRoot), 'surveys', `${surveyId}.json`);
    try {
      return await this.#readFile(filePath);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async #readFile(filePath) {
    try {
      const value = JSON.parse(await fs.readFile(filePath, 'utf8'));
      const survey = validateSurveyDefinition(value, filePath);
      if (path.basename(filePath, '.json') !== survey.id) {
        throw Object.assign(new Error(`Survey filename must match its id: ${filePath}`), {
          code: 'INVALID_SURVEY_DEFINITION',
        });
      }
      return survey;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw Object.assign(new Error(`Survey definition is not valid JSON: ${filePath}`), {
          code: 'INVALID_SURVEY_DEFINITION',
        });
      }
      throw error;
    }
  }
}

module.exports = {
  SURVEY_ID_PATTERN,
  SurveyDefinitionStore,
  validateSurveyDefinition,
};
