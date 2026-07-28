const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CernereIntegrationError,
} = require('./cernereErrors');
const {
  POSTGRES_INTEGER_MAX,
} = require('../../corpus/surveyContract');
const {
  VolputasSurveyResponseStore,
} = require('./volputasSurveyResponseStore');

const USER_ID = '66e242b5-2f18-4463-b7f0-c0f12d818a20';
const SURVEY_ID = 'd2c6aca2-e754-4e4a-9f2b-270c85b989e5';

function harness() {
  const calls = [];
  const responses = [];
  const projectClient = {
    async request(module, action, payload) {
      calls.push({ module, action, payload });
      return responses.shift();
    },
    close() {
      calls.push({ action: 'close' });
    },
  };
  return {
    calls,
    responses,
    store: new VolputasSurveyResponseStore(projectClient),
  };
}

test('uses only the Volputas project survey commands with normalized payloads', async () => {
  const { calls, responses, store } = harness();
  responses.push(
    { answeredSurveyIds: [SURVEY_ID] },
    {
      surveyId: SURVEY_ID,
      answers: [{ questionId: 'rating', intValue: 4 }],
      submittedAt: '2026-07-24T01:00:00.000Z',
    },
    {
      surveyId: SURVEY_ID,
      answers: [{ questionId: 'comment', textValue: 'safe fixture' }],
      submittedAt: '2026-07-24T02:00:00.000Z',
    },
  );

  assert.deepEqual(
    await store.listStatuses(USER_ID, [SURVEY_ID]),
    { answeredSurveyIds: [SURVEY_ID] },
  );
  assert.equal((await store.getResponse(USER_ID, SURVEY_ID)).answers[0].intValue, 4);
  assert.equal((await store.saveResponse({
    userId: USER_ID,
    surveyId: SURVEY_ID,
    answers: [{ questionId: 'comment', textValue: 'safe fixture' }],
  })).answers[0].textValue, 'safe fixture');

  assert.deepEqual(
    calls.map(({ module, action }) => [module, action]),
    [
      ['volputas_survey', 'list_response_statuses'],
      ['volputas_survey', 'get_response'],
      ['volputas_survey', 'save_response'],
    ],
  );
  assert.deepEqual(calls[2].payload, {
    userId: USER_ID,
    surveyId: SURVEY_ID,
    answers: [{ questionId: 'comment', textValue: 'safe fixture' }],
  });
});

test('chunks status requests at the Cernere transport boundary', async () => {
  const { calls, responses, store } = harness();
  const surveyIds = Array.from(
    { length: 501 },
    (_, index) => (
      `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`
    ),
  );
  responses.push(
    { answeredSurveyIds: [surveyIds[0]] },
    { answeredSurveyIds: [surveyIds[500]] },
  );

  await assert.doesNotReject(async () => {
    assert.deepEqual(
      await store.listStatuses(USER_ID, surveyIds),
      { answeredSurveyIds: [surveyIds[0], surveyIds[500]] },
    );
  });
  assert.deepEqual(
    calls.map(({ payload }) => payload.surveyIds.length),
    [500, 1],
  );
});

test('fails closed on malformed Cernere response data', async () => {
  const { responses, store } = harness();
  responses.push({
    surveyId: SURVEY_ID,
    answers: [{ questionId: 'rating', intValue: 4, textValue: 'both' }],
    submittedAt: 'not-a-date',
  });

  await assert.rejects(
    store.getResponse(USER_ID, SURVEY_ID),
    CernereIntegrationError,
  );
});

test('rejects integer answers outside the Cernere PostgreSQL contract', async () => {
  const outgoing = harness();
  await assert.rejects(
    outgoing.store.saveResponse({
      userId: USER_ID,
      surveyId: SURVEY_ID,
      answers: [{
        questionId: 'rating',
        intValue: POSTGRES_INTEGER_MAX + 1,
      }],
    }),
  );
  assert.equal(outgoing.calls.length, 0);

  const incoming = harness();
  incoming.responses.push({
    surveyId: SURVEY_ID,
    answers: [{
      questionId: 'rating',
      intValue: POSTGRES_INTEGER_MAX + 1,
    }],
    submittedAt: '2026-07-24T01:00:00.000Z',
  });
  await assert.rejects(
    incoming.store.getResponse(USER_ID, SURVEY_ID),
    CernereIntegrationError,
  );
});

test('rejects PostgreSQL-incompatible Unicode text in both directions', async () => {
  const outgoing = harness();
  for (const textValue of ['before\u0000after', 'trailing\uD800']) {
    await assert.rejects(
      outgoing.store.saveResponse({
        userId: USER_ID,
        surveyId: SURVEY_ID,
        answers: [{ questionId: 'comment', textValue }],
      }),
    );
  }
  assert.equal(outgoing.calls.length, 0);

  const incoming = harness();
  incoming.responses.push({
    surveyId: SURVEY_ID,
    answers: [{ questionId: 'comment', textValue: 'trailing\uD800' }],
    submittedAt: '2026-07-24T01:00:00.000Z',
  });
  await assert.rejects(
    incoming.store.getResponse(USER_ID, SURVEY_ID),
    CernereIntegrationError,
  );
});

test('rejects duplicate, unrequested, and mismatched upstream identifiers', async () => {
  const { responses, store } = harness();
  const otherSurveyId = '3e3794ea-6c3c-46cb-87eb-28264f4ae24c';
  responses.push(
    { answeredSurveyIds: [otherSurveyId] },
    { answeredSurveyIds: [SURVEY_ID, SURVEY_ID] },
    {
      surveyId: otherSurveyId,
      answers: [{ questionId: 'rating', intValue: 4 }],
      submittedAt: '2026-07-24T01:00:00.000Z',
    },
    {
      surveyId: otherSurveyId,
      answers: [{ questionId: 'rating', intValue: 4 }],
      submittedAt: '2026-07-24T01:00:00.000Z',
    },
  );

  await assert.rejects(
    store.listStatuses(USER_ID, [SURVEY_ID]),
    CernereIntegrationError,
  );
  await assert.rejects(
    store.listStatuses(USER_ID, [SURVEY_ID]),
    CernereIntegrationError,
  );
  await assert.rejects(
    store.getResponse(USER_ID, SURVEY_ID),
    CernereIntegrationError,
  );
  await assert.rejects(
    store.saveResponse({
      userId: USER_ID,
      surveyId: SURVEY_ID,
      answers: [{ questionId: 'rating', intValue: 4 }],
    }),
    CernereIntegrationError,
  );
});
