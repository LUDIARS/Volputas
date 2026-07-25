const test = require('node:test');
const assert = require('node:assert/strict');
const { listSurveysWithResponseStatus } = require('./surveyResponseStatus');

test('marks each survey answered or unanswered from its response file', async () => {
  const responses = new Map([
    ['answered-survey', { updatedAt: '2026-07-25T00:00:00.000Z' }],
  ]);
  const responseStore = {
    read: async ({ surveyId }) => responses.get(surveyId) ?? null,
  };

  const result = await listSurveysWithResponseStatus({
    surveys: [
      { id: 'answered-survey', title: 'Answered' },
      { id: 'new-survey', title: 'New' },
    ],
    responseStore,
    repositoryRoot: 'C:\\data',
    githubName: 'neco',
  });

  assert.deepEqual(result, [
    {
      id: 'answered-survey',
      title: 'Answered',
      responseStatus: 'answered',
      responseUpdatedAt: '2026-07-25T00:00:00.000Z',
    },
    {
      id: 'new-survey',
      title: 'New',
      responseStatus: 'unanswered',
      responseUpdatedAt: null,
    },
  ]);
});
