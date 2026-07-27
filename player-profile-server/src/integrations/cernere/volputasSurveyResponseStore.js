const { z } = require('zod');
const {
  POSTGRES_INTEGER_MAX,
  POSTGRES_INTEGER_MIN,
  hasUnpairedSurrogate,
} = require('../../corpus/surveyContract');
const { CernereIntegrationError } = require('./cernereErrors');

const MAX_STATUS_IDS_PER_REQUEST = 500;
const uuidSchema = z.string().uuid().transform((value) => value.toLowerCase());
const normalizedAnswerSchema = z.object({
  questionId: z.string().regex(/^[a-z][a-z0-9_-]{0,99}$/),
  textValue: z.string().max(4000)
    .refine((value) => (
      !value.includes('\u0000') && !hasUnpairedSurrogate(value)
    ))
    .optional(),
  intValue: z.number().int()
    .min(POSTGRES_INTEGER_MIN)
    .max(POSTGRES_INTEGER_MAX)
    .optional(),
}).strict().superRefine((answer, context) => {
  if ((answer.textValue === undefined) === (answer.intValue === undefined)) {
    context.addIssue({
      code: 'custom',
      message: 'exactly one answer value is required',
    });
  }
});

const normalizedAnswersSchema = z.array(normalizedAnswerSchema).max(100)
  .superRefine((answers, context) => {
    const ids = new Set();
    answers.forEach((answer, index) => {
      if (ids.has(answer.questionId)) {
        context.addIssue({
          code: 'custom',
          message: 'duplicate questionId',
          path: [index, 'questionId'],
        });
      }
      ids.add(answer.questionId);
    });
  });

const responseSchema = z.object({
  surveyId: uuidSchema,
  answers: normalizedAnswersSchema,
  submittedAt: z.string().datetime(),
}).strict();

function parseUpstream(schema, value, name) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new CernereIntegrationError(`Cernere returned an invalid ${name} response`);
  }
  return parsed.data;
}

class VolputasSurveyResponseStore {
  constructor(projectClient) {
    this.projectClient = projectClient;
  }

  async listStatuses(userId, surveyIds) {
    const validUserId = uuidSchema.parse(userId);
    const validSurveyIds = z.array(uuidSchema).parse(surveyIds);
    const answered = [];
    const seenAnswered = new Set();
    for (let offset = 0; offset < validSurveyIds.length; offset += MAX_STATUS_IDS_PER_REQUEST) {
      const batch = validSurveyIds.slice(offset, offset + MAX_STATUS_IDS_PER_REQUEST);
      const value = await this.projectClient.request(
        'volputas_survey',
        'list_response_statuses',
        { userId: validUserId, surveyIds: batch },
      );
      const status = parseUpstream(
        z.object({
          answeredSurveyIds: z.array(uuidSchema).max(MAX_STATUS_IDS_PER_REQUEST),
        }).strict(),
        value,
        'survey status',
      );
      const requested = new Set(batch);
      const batchAnswered = new Set(status.answeredSurveyIds);
      if (
        batchAnswered.size !== status.answeredSurveyIds.length ||
        status.answeredSurveyIds.some((surveyId) => (
          seenAnswered.has(surveyId) || !requested.has(surveyId)
        ))
      ) {
        throw new CernereIntegrationError('Cernere returned an invalid survey status response');
      }
      for (const surveyId of status.answeredSurveyIds) {
        seenAnswered.add(surveyId);
        answered.push(surveyId);
      }
    }
    return { answeredSurveyIds: answered };
  }

  async getResponse(userId, surveyId) {
    const validSurveyId = uuidSchema.parse(surveyId);
    const value = await this.projectClient.request(
      'volputas_survey',
      'get_response',
      {
        userId: uuidSchema.parse(userId),
        surveyId: validSurveyId,
      },
    );
    if (value === null) return null;
    const response = parseUpstream(responseSchema, value, 'survey');
    if (response.surveyId !== validSurveyId) {
      throw new CernereIntegrationError('Cernere returned an invalid survey response');
    }
    return response;
  }

  async saveResponse({ userId, surveyId, answers }) {
    const input = {
      userId: uuidSchema.parse(userId),
      surveyId: uuidSchema.parse(surveyId),
      answers: normalizedAnswersSchema.parse(answers),
    };
    const value = await this.projectClient.request(
      'volputas_survey',
      'save_response',
      input,
    );
    const response = parseUpstream(responseSchema, value, 'saved survey');
    if (response.surveyId !== input.surveyId) {
      throw new CernereIntegrationError('Cernere returned an invalid saved survey response');
    }
    return response;
  }

  close() {
    return this.projectClient.close();
  }
}

module.exports = {
  VolputasSurveyResponseStore,
};
