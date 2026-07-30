const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createReviewRelayService, sanitizeMentions } = require('./reviewRelayService');

function record(overrides = {}) {
  return {
    id: 'r1', gameTitle: 'Elden Ring', recommend: true, comment: 'good',
    visibility: 'community', anonymous: false, relayedAt: null,
    glabProjectId: null, authorName: 'Alice',
    ...overrides,
  };
}

function makeService(overrides = {}) {
  const calls = [];
  const updates = [];
  const glabRelayClient = {
    async relayReview(payload) { calls.push(payload); return { ok: true }; },
    ...(overrides.glabRelayClient || {}),
  };
  const service = createReviewRelayService({
    glabRelayClient,
    voiceStore: {
      async markRelayed(id, at, marked) { updates.push({ id, at, record: marked }); },
    },
    logger: { warn() {}, info() {} },
    reviewBaseUrl: 'https://voluptas.example',
  });
  return { service, calls, updates };
}

test('community records are relayed once, keyed by the review id', async () => {
  const { service, calls, updates } = makeService();
  const result = await service.relay(record());
  assert.equal(result.relayed, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].reviewId, 'r1');
  assert.equal(updates.length, 1);
});

test('the record is handed back to the store so it can key on the owner id', async () => {
  const { service, updates } = makeService();
  await service.relay(record({ userId: 'owner-1' }));
  assert.equal(updates[0].record.userId, 'owner-1');
  assert.match(updates[0].at, /^\d{4}-\d{2}-\d{2}T/);
});

test('the relayed link points at Volputas, scoped to the project when known', async () => {
  const { service, calls } = makeService();
  await service.relay(record());
  assert.equal(calls[0].url, 'https://voluptas.example/reviews');
  await service.relay(record({ id: 'r2', glabProjectId: 'proj/1' }));
  assert.equal(calls[1].url, 'https://voluptas.example/projects/proj%2F1/reviews');
});

test('recommend is forwarded as a boolean, not a localised string', async () => {
  const { service, calls } = makeService();
  await service.relay(record({ recommend: false }));
  assert.equal(calls[0].recommend, false);
  await service.relay(record({ id: 'r2', recommend: null }));
  assert.equal(calls[1].recommend, null);
});

test('private records are never relayed', async () => {
  const { service, calls } = makeService();
  assert.equal((await service.relay(record({ visibility: 'private' }))).relayed, false);
  assert.equal(calls.length, 0);
});

test('already relayed records are skipped', async () => {
  const { service, calls } = makeService();
  assert.equal((await service.relay(record({ relayedAt: '2026-07-30T00:00:00Z' }))).relayed, false);
  assert.equal(calls.length, 0);
});

test('anonymous records never leak the display name', async () => {
  const { service, calls } = makeService();
  await service.relay(record({ anonymous: true, authorName: 'Alice' }));
  assert.ok(!JSON.stringify(calls[0]).includes('Alice'));
});

test('relay failures never throw and never mark the record as relayed', async () => {
  const { service, updates } = makeService({
    glabRelayClient: { async relayReview() { throw new Error('glab down'); } },
  });
  assert.equal((await service.relay(record())).relayed, false);
  assert.equal(updates.length, 0);
});

test('a missing glab relay client degrades instead of throwing', async () => {
  const service = createReviewRelayService({
    glabRelayClient: null,
    voiceStore: { async markRelayed() { throw new Error('must not be called'); } },
    logger: { warn() {}, info() {} },
    reviewBaseUrl: 'https://voluptas.example',
  });
  assert.equal((await service.relay(record())).relayed, false);
});

test('mass mentions are neutralised but stay readable', () => {
  const out = sanitizeMentions('yo @everyone and @here and <@123>');
  assert.ok(!/(^|[^\u200b])@everyone/.test(out), '@everyone must be neutralised');
  assert.ok(!/(^|[^\u200b])@here/.test(out), '@here must be neutralised');
  assert.ok(out.includes('everyone'), 'text must remain readable');
});

test('the excerpt is capped', async () => {
  const { service, calls } = makeService();
  await service.relay(record({ comment: 'a'.repeat(1000) }));
  assert.ok(calls[0].excerpt.length <= 300, `got ${calls[0].excerpt.length}`);
});
