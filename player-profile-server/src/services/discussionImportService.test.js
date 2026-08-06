const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DiscussionImportService,
  discussionSourceRef,
  latestOccurredAt,
} = require('./discussionImportService');

function createService({
  consent = true,
  identity = { provider_sub: '123456789012345678' },
  current = [],
  utterances = [],
} = {}) {
  const created = [];
  const bridgeCalls = [];
  return {
    created,
    bridgeCalls,
    service: new DiscussionImportService({
      userModel: {
        async findById() {
          return { discussion_import_consent: consent };
        },
      },
      identityModel: {
        async findVerifiedByProvider(userId, provider) {
          assert.equal(userId, 'user-1');
          assert.equal(provider, 'discord');
          return identity;
        },
      },
      evidenceStore: {
        async list(userId, kind) {
          assert.equal(userId, 'user-1');
          assert.equal(kind, 'voices');
          return current;
        },
        async create(userId, kind, record) {
          created.push({ userId, kind, record });
        },
      },
      bridgeClient: {
        async listUtterances(input) {
          bridgeCalls.push(input);
          return utterances;
        },
      },
    }),
  };
}

test('discussion import requires explicit consent before contacting Di', async () => {
  const context = createService({ consent: false });
  await assert.rejects(context.service.sync('user-1'), {
    code: 'DISCUSSION_IMPORT_CONSENT_REQUIRED',
  });
  assert.equal(context.bridgeCalls.length, 0);
});

test('discussion import requires an OIDC-verified Discord identity', async () => {
  const context = createService({ identity: null });
  await assert.rejects(context.service.sync('user-1'), {
    code: 'VERIFIED_DISCORD_IDENTITY_REQUIRED',
  });
  assert.equal(context.bridgeCalls.length, 0);
});

test('discussion import is incremental, deduplicated, and identity-free at rest', async () => {
  const current = [{
    sourceKind: 'discussion',
    sourceRef: 'existing-id',
    occurredAt: '2026-07-28T01:00:00.000Z',
    comment: 'already imported',
  }];
  const context = createService({
    current,
    utterances: [
      {
        text: 'already imported',
        createdAt: '2026-07-28T01:00:00.000Z',
      },
      {
        text: 'I liked the risk and reward.',
        createdAt: '2026-07-28T01:01:00.000Z',
      },
      {
        text: 'I liked the risk and reward.',
        createdAt: '2026-07-28T01:01:00.000Z',
      },
    ],
  });

  const result = await context.service.sync('user-1');
  assert.deepEqual(result, { received: 3, imported: 1, duplicate: 2 });
  assert.deepEqual(context.bridgeCalls, [{
    authorId: '123456789012345678',
    since: Date.parse('2026-07-28T01:00:00.000Z'),
  }]);
  assert.equal(context.created.length, 1);
  assert.equal(context.created[0].kind, 'voices');
  assert.equal(context.created[0].record.sourceKind, 'discussion');
  assert.equal(context.created[0].record.sourceRef, discussionSourceRef({
    text: 'I liked the risk and reward.',
    createdAt: '2026-07-28T01:01:00.000Z',
  }));
  assert.match(context.created[0].record.sourceRef, /^di:[A-Za-z0-9_-]{43}$/);
  assert.equal(context.created[0].record.comment, 'I liked the risk and reward.');
  assert.equal(
    JSON.stringify(context.created[0].record).includes('123456789012345678'),
    false
  );
  assert.equal(latestOccurredAt(current), Date.parse('2026-07-28T01:00:00.000Z'));
});
