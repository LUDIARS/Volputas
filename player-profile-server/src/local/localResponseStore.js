const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function validateAnswers(survey, answers) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    throw Object.assign(new Error('Survey answers must be an object'), {
      code: 'INVALID_SURVEY_ANSWERS',
    });
  }

  const normalized = {};
  for (const question of survey.questions) {
    const answer = answers[question.id];
    if (
      answer === undefined
      || answer === null
      || answer === ''
      || (typeof answer === 'string' && answer.trim() === '')
    ) {
      throw Object.assign(new Error(`Answer is required: ${question.text}`), {
        code: 'INCOMPLETE_SURVEY_RESPONSE',
        questionId: question.id,
      });
    }

    if (question.type === 'choice') {
      const allowedValues = question.options.map((option) =>
        typeof option === 'object' ? option.value : option
      );
      if (!allowedValues.includes(answer)) {
        throw Object.assign(new Error(`Invalid answer for question: ${question.text}`), {
          code: 'INVALID_SURVEY_ANSWER',
          questionId: question.id,
        });
      }
    } else if (question.type === 'scale') {
      const minimum = question.options?.min ?? 1;
      const maximum = question.options?.max ?? 5;
      if (!Number.isFinite(answer) || answer < minimum || answer > maximum) {
        throw Object.assign(new Error(`Invalid scale value for question: ${question.text}`), {
          code: 'INVALID_SURVEY_ANSWER',
          questionId: question.id,
        });
      }
    } else if (typeof answer !== 'string') {
      throw Object.assign(new Error(`Answer must be text: ${question.text}`), {
        code: 'INVALID_SURVEY_ANSWER',
        questionId: question.id,
      });
    }

    normalized[question.id] = answer;
  }
  return normalized;
}

function responsePath(repositoryRoot, githubName, surveyId) {
  const root = path.resolve(repositoryRoot);
  const target = path.resolve(root, 'answers', githubName, `${surveyId}.json`);
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw Object.assign(new Error('Survey response path escapes the data repository'), {
      code: 'INVALID_RESPONSE_PATH',
    });
  }
  return target;
}

class LocalResponseStore {
  constructor(now = () => new Date()) {
    this.now = now;
  }

  async read({ repositoryRoot, githubName, surveyId }) {
    const filePath = responsePath(repositoryRoot, githubName, surveyId);
    try {
      return JSON.parse(await fs.readFile(filePath, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      if (error instanceof SyntaxError) {
        throw Object.assign(new Error(`Survey response is not valid JSON: ${filePath}`), {
          code: 'INVALID_RESPONSE_FILE',
        });
      }
      throw error;
    }
  }

  async write({ repositoryRoot, githubName, author, survey, answers }) {
    const normalizedAnswers = validateAnswers(survey, answers);
    const filePath = responsePath(repositoryRoot, githubName, survey.id);
    const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    const response = {
      schemaVersion: 1,
      survey: {
        id: survey.id,
        title: survey.title,
      },
      respondent: {
        githubName,
        gitAuthor: {
          name: author.name,
          email: author.email,
        },
      },
      dataRepository: {
        remoteUrl: author.remoteUrl,
      },
      answers: normalizedAnswers,
      updatedAt: this.now().toISOString(),
    };

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify(response, null, 2)}\n`, 'utf8');
      await fs.rename(temporaryPath, filePath);
    } catch (error) {
      await fs.unlink(temporaryPath).catch(() => {
        // The temporary file may not exist if creation itself failed.
      });
      throw error;
    }

    return { filePath, response };
  }
}

module.exports = {
  LocalResponseStore,
  responsePath,
  validateAnswers,
};
