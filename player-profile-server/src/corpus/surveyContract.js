const { z } = require('zod');
const { AppError } = require('../middleware/errorHandler');

const SURVEY_CATEGORIES = ['game_review', 'game_survey', 'peer_question'];
const POSTGRES_INTEGER_MIN = -2_147_483_648;
const POSTGRES_INTEGER_MAX = 2_147_483_647;
const categorySchema = z.enum(SURVEY_CATEGORIES);
const uuidSchema = z.string().uuid().transform((value) => value.toLowerCase());
const questionIdSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,99}$/);

function hasUnpairedSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xD800 && codeUnit <= 0xDBFF) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (!(nextCodeUnit >= 0xDC00 && nextCodeUnit <= 0xDFFF)) return true;
      index += 1;
    } else if (codeUnit >= 0xDC00 && codeUnit <= 0xDFFF) {
      return true;
    }
  }
  return false;
}

const safeTextSchema = z.string().max(4_000).refine(
  (value) => !value.includes('\u0000') && !hasUnpairedSurrogate(value),
  { message: 'text contains unsupported Unicode' },
);

const baseQuestionSchema = z.object({
  id: questionIdSchema,
  text: z.string().trim().min(1).max(1_000),
  required: z.boolean().default(false),
}).strict();

const scaleQuestionSchema = baseQuestionSchema.extend({
  type: z.literal('scale'),
  options: z.object({
    min: z.number().int().min(POSTGRES_INTEGER_MIN).max(POSTGRES_INTEGER_MAX).default(1),
    max: z.number().int().min(POSTGRES_INTEGER_MIN).max(POSTGRES_INTEGER_MAX).default(5),
  }).strict().default({ min: 1, max: 5 }),
}).superRefine((question, context) => {
  if (question.options.min >= question.options.max) {
    context.addIssue({
      code: 'custom',
      path: ['options'],
      message: 'scale min must be less than max',
    });
  }
});

const choiceQuestionSchema = baseQuestionSchema.extend({
  type: z.literal('choice'),
  options: z.object({
    choices: z.array(z.string().min(1).max(500)).min(1).max(100),
  }).strict(),
}).superRefine((question, context) => {
  if (new Set(question.options.choices).size !== question.options.choices.length) {
    context.addIssue({
      code: 'custom',
      path: ['options', 'choices'],
      message: 'choice values must be unique',
    });
  }
});

const freetextQuestionSchema = baseQuestionSchema.extend({
  type: z.literal('freetext'),
  options: z.undefined().optional(),
});

const questionSchema = z.discriminatedUnion('type', [
  scaleQuestionSchema,
  choiceQuestionSchema,
  freetextQuestionSchema,
]);

const surveyRowSchema = z.object({
  id: uuidSchema,
  title: z.string().min(1).max(255),
  description: z.string().nullable(),
  questions: z.array(questionSchema).max(100),
  category: categorySchema,
  created_at: z.union([z.date(), z.string().datetime()]),
}).strict();

class SurveyContractError extends Error {
  constructor() {
    super('Survey response does not match the selected survey definition');
    this.name = 'SurveyContractError';
  }
}

function invalidResponse(message) {
  return new AppError(400, 'INVALID_SURVEY_RESPONSE', message);
}

function normalizeSurvey(row) {
  const parsed = surveyRowSchema.safeParse(row);
  if (!parsed.success) {
    throw new AppError(500, 'INVALID_SURVEY_DEFINITION', 'Stored survey definition is invalid');
  }
  const ids = new Set();
  for (const question of parsed.data.questions) {
    if (ids.has(question.id)) {
      throw new AppError(500, 'INVALID_SURVEY_DEFINITION', 'Stored survey definition is invalid');
    }
    ids.add(question.id);
  }
  return {
    id: parsed.data.id,
    title: parsed.data.title,
    description: parsed.data.description,
    questions: parsed.data.questions,
    category: parsed.data.category,
    createdAt: (
      parsed.data.created_at instanceof Date
        ? parsed.data.created_at
        : new Date(parsed.data.created_at)
    ).toISOString(),
  };
}

function validateCategory(value) {
  if (value === undefined) return null;
  const parsed = categorySchema.safeParse(value);
  if (!parsed.success) {
    throw new AppError(400, 'INVALID_SURVEY_CATEGORY', 'Invalid survey category');
  }
  return parsed.data;
}

function validateSurveyId(value) {
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) {
    throw new AppError(400, 'INVALID_SURVEY_ID', 'Invalid survey ID');
  }
  return parsed.data;
}

function validateUserId(value) {
  return uuidSchema.parse(value);
}

function validateAnswers(questions, value) {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw invalidResponse('answers must be an object');
  }

  const known = new Map(questions.map((question) => [question.id, question]));
  const providedIds = Object.keys(value);
  if (providedIds.length > 100) throw invalidResponse('answers exceed the question limit');
  for (const id of providedIds) {
    if (!known.has(id)) throw invalidResponse('Unknown survey question');
  }

  const normalized = [];
  for (const question of questions) {
    const answer = value[question.id];
    const omitted = answer === undefined || answer === '';
    if (omitted) {
      if (question.required) throw invalidResponse(`Answer is required: ${question.id}`);
      continue;
    }

    if (question.type === 'scale') {
      if (
        !Number.isInteger(answer)
        || answer < POSTGRES_INTEGER_MIN
        || answer > POSTGRES_INTEGER_MAX
        || answer < question.options.min
        || answer > question.options.max
      ) {
        throw invalidResponse(`Invalid scale answer: ${question.id}`);
      }
      normalized.push({ questionId: question.id, intValue: answer });
      continue;
    }

    if (typeof answer !== 'string' || !safeTextSchema.safeParse(answer).success) {
      throw invalidResponse(`Invalid text answer: ${question.id}`);
    }
    if (question.type === 'choice' && !question.options.choices.includes(answer)) {
      throw invalidResponse(`Invalid choice answer: ${question.id}`);
    }
    if (question.type === 'freetext' && question.required && !answer.trim()) {
      throw invalidResponse(`Answer is required: ${question.id}`);
    }
    normalized.push({ questionId: question.id, textValue: answer });
  }
  return normalized;
}

function responseView(survey, response) {
  if (response.surveyId !== survey.id) throw new SurveyContractError();

  const answers = {};
  for (const answer of response.answers) {
    if (Object.hasOwn(answers, answer.questionId)) throw new SurveyContractError();
    answers[answer.questionId] = answer.textValue ?? answer.intValue;
  }

  let normalized;
  try {
    normalized = validateAnswers(
      survey.questions.map((question) => ({ ...question, required: false })),
      answers,
    );
  } catch {
    throw new SurveyContractError();
  }
  if (normalized.length !== response.answers.length) throw new SurveyContractError();

  return {
    surveyId: response.surveyId,
    answers,
    submittedAt: response.submittedAt,
  };
}

function surveyView(survey, answered) {
  return { ...survey, answered };
}

module.exports = {
  POSTGRES_INTEGER_MAX,
  POSTGRES_INTEGER_MIN,
  SURVEY_CATEGORIES,
  SurveyContractError,
  hasUnpairedSurrogate,
  normalizeSurvey,
  responseView,
  surveyView,
  validateAnswers,
  validateCategory,
  validateSurveyId,
  validateUserId,
};
