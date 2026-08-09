// 管理者が登録するアンケート定義の入力契約。
//
// surveyContract は「保存済みの行を GLAB へ出せる形か」を検査する読み出し側の
// 契約で、 不一致は 500 (INVALID_SURVEY_DEFINITION) になる。 管理者入力を
// そのまま保存すると、 その 500 が保存後に初めて出る。 ここで保存前に同じ
// 設問形 (scale / choice / freetext) へ通し、 弾くなら 400 で弾く。
const { z } = require('zod');
const { AppError } = require('../middleware/errorHandler');
const {
  SURVEY_CATEGORIES,
  POSTGRES_INTEGER_MAX,
  POSTGRES_INTEGER_MIN,
  hasUnpairedSurrogate,
} = require('./surveyContract');

const databaseText = (schema) => schema.refine(
  (value) => !value.includes('\u0000') && !hasUnpairedSurrogate(value),
  'text contains unsupported Unicode',
);

const questionIdSchema = z.string().regex(
  /^[a-z][a-z0-9_-]{0,99}$/,
  'question id must start with a lowercase letter and use [a-z0-9_-]',
);

const baseQuestionSchema = z.object({
  id: questionIdSchema,
  text: databaseText(z.string().trim().min(1).max(1_000)),
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
    context.addIssue({ code: 'custom', path: ['options'], message: 'scale min must be less than max' });
  }
});

const choiceQuestionSchema = baseQuestionSchema.extend({
  type: z.literal('choice'),
  options: z.object({
    choices: z.array(databaseText(z.string().trim().min(1).max(500))).min(1).max(100),
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

const questionsSchema = z.array(questionSchema).min(1).max(100).superRefine((questions, context) => {
  const ids = new Set();
  for (const question of questions) {
    if (ids.has(question.id)) {
      context.addIssue({ code: 'custom', message: `duplicate question id: ${question.id}` });
    }
    ids.add(question.id);
  }
});

const optionalGameId = z.string().uuid().nullish().transform(
  (value) => (value === undefined || value === '' ? undefined : value?.toLowerCase() ?? null),
);

const definitionSchema = z.object({
  title: databaseText(z.string().trim().min(1).max(255)),
  description: databaseText(z.string().trim().max(4_000)).nullish().transform(
    (value) => (value === undefined || value === null || value === '' ? null : value),
  ),
  questions: questionsSchema,
  category: z.enum(SURVEY_CATEGORIES).default('game_survey'),
  gameId: optionalGameId,
  // 登録直後に学生へ見せるかどうか。 既定は非公開にして、 内容を確認してから
  // 公開へ倒せるようにする。
  visibleToGlab: z.boolean().default(false),
  isActive: z.boolean().default(true),
}).strict();

// 既定値付きの項目を .partial() でそのまま流用すると、 空ボディでも既定値が
// 補われて「何も指定していない PATCH」が通ってしまう。 更新側は既定を外す。
const definitionUpdateSchema = definitionSchema
  .omit({ category: true, visibleToGlab: true, isActive: true })
  .extend({
    category: z.enum(SURVEY_CATEGORIES),
    visibleToGlab: z.boolean(),
    isActive: z.boolean(),
  })
  .partial()
  .strict();

function invalidDefinition(error) {
  return new AppError(
    400,
    'INVALID_SURVEY_DEFINITION_INPUT',
    Object.entries(error.flatten().fieldErrors)
      .map(([field, messages]) => `${field}: ${messages.join(', ')}`)
      .join('; ') || 'Invalid survey definition',
  );
}

function validateSurveyDefinition(body) {
  const parsed = definitionSchema.safeParse(body ?? {});
  if (!parsed.success) throw invalidDefinition(parsed.error);
  return parsed.data;
}

function validateSurveyDefinitionUpdate(body) {
  const parsed = definitionUpdateSchema.safeParse(body ?? {});
  if (!parsed.success) throw invalidDefinition(parsed.error);
  if (Object.keys(parsed.data).length === 0) {
    throw new AppError(
      400,
      'INVALID_SURVEY_DEFINITION_INPUT',
      'No updatable fields were provided',
    );
  }
  return parsed.data;
}

module.exports = {
  validateSurveyDefinition,
  validateSurveyDefinitionUpdate,
};
