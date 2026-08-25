const test = require('node:test');
const assert = require('node:assert/strict');
const { createImpressionDiscussionService } = require('./impressionDiscussionService');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const IMPRESSION_ID = '22222222-2222-4222-8222-222222222222';

function fixture({ consent = true, analysis = null } = {}) {
  const publications = [];
  const service = createImpressionDiscussionService({
    impressions: {
      async getOwned() {
        return {
          id: IMPRESSION_ID,
          session_id: 'session-1',
          status: 'ready',
          text: '探索と音楽が良かった。',
          client: { source: 'volputas_web_game_review', rating: 5 },
        };
      },
    },
    users: {
      async findById() { return { id: USER_ID, research_export_consent: consent }; },
    },
    sessions: {
      async findById() { return { id: 'session-1', user_id: USER_ID, game_id: 'Example Game' }; },
    },
    profiles: {
      async findByUserId() { return { playstyle_tags: ['探索型'] }; },
    },
    evidenceStore: {
      async readAnalysis() {
        return analysis || {
          schemaVersion: 2,
          affect: { vector: Array(20).fill(0.5), vectorSpecVersion: 1 },
          preferenceAxes: {},
          aversions: [],
          mechanicReactions: [],
        };
      },
    },
    pseudoIdSecret: 'test-secret',
    publisher: {
      async publish(input) {
        publications.push(input);
        return { sessionId: '33333333-3333-4333-8333-333333333333', reviewRequired: false };
      },
    },
  });
  return { service, publications };
}

test('publishes only an anonymized persona and the owned game review', async () => {
  const { service, publications } = fixture();
  const result = await service.start({ impressionId: IMPRESSION_ID, userId: USER_ID });
  assert.equal(result.sessionId, '33333333-3333-4333-8333-333333333333');
  assert.equal(publications.length, 1);
  assert.match(publications[0].persona.pseudoId, /^ext:voluptas:[0-9a-f]{16}$/);
  assert.equal(publications[0].persona.userId, undefined);
  assert.deepEqual(publications[0].review, {
    gameTitle: 'Example Game',
    rating: 5,
    text: '探索と音楽が良かった。',
  });
});

test('fails closed before reading analysis when export consent is absent', async () => {
  let analysisRead = false;
  const publications = [];
  const service = createImpressionDiscussionService({
    impressions: {
      async getOwned() {
        return {
          session_id: 'session-1',
          status: 'ready',
          client: { source: 'volputas_web_game_review' },
        };
      },
    },
    users: { async findById() { return { research_export_consent: false }; } },
    sessions: { async findById() { return { user_id: USER_ID }; } },
    profiles: { async findByUserId() { return null; } },
    evidenceStore: { async readAnalysis() { analysisRead = true; } },
    pseudoIdSecret: 'test-secret',
    publisher: { async publish() { publications.push(true); } },
  });

  await assert.rejects(
    () => service.start({ impressionId: IMPRESSION_ID, userId: USER_ID }),
    { code: 'PERSONA_EXPORT_CONSENT_REQUIRED', statusCode: 409 }
  );
  assert.equal(analysisRead, false);
  assert.equal(publications.length, 0);
});

test('rejects impressions that were not created as game reviews', async () => {
  let userRead = false;
  const service = createImpressionDiscussionService({
    impressions: {
      async getOwned() {
        return {
          session_id: 'session-1',
          status: 'ready',
          text: 'ordinary impression',
          client: { source: 'spectator_capture', rating: 5 },
        };
      },
    },
    users: { async findById() { userRead = true; } },
    sessions: { async findById() { return null; } },
    profiles: { async findByUserId() { return null; } },
    evidenceStore: { async readAnalysis() { assert.fail('analysis must not be read'); } },
    pseudoIdSecret: 'test-secret',
    publisher: { async publish() { assert.fail('publisher must not run'); } },
  });

  await assert.rejects(
    () => service.start({ impressionId: IMPRESSION_ID, userId: USER_ID }),
    { code: 'GAME_REVIEW_REQUIRED', statusCode: 409 }
  );
  assert.equal(userRead, false);
});
