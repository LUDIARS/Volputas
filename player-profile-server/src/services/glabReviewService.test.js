const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createGlabReviewService } = require('./glabReviewService');

const GAME_ID = '3f1a2b4c-5d6e-4f70-8192-a3b4c5d6e7f8';

function record(overrides = {}) {
  return {
    id: 'v1', userId: 'u1', gameTitle: 'Elden Ring', recommend: true,
    polarity: 'like', comment: 'good', tags: [], glabProjectId: null,
    visibility: 'community', anonymous: false, createdAt: '2026-07-30T00:00:00Z',
    ...overrides,
  };
}

function makeService(records, calls = []) {
  return createGlabReviewService({
    voiceStore: { async listVoices() { return records; }, async saveVoice(value) { return value; } },
    resolveDisplayName: async (userId) => {
      calls.push(userId);
      return 'Alice';
    },
    pseudoId: (userId) => {
      if (typeof userId !== 'string' || !userId) throw new TypeError('sid must be a non-empty string');
      return 'pseudo-xyz';
    },
    gameRepository: {
      async findById() {
        return { id: GAME_ID, title: 'Uni Quest', is_active: true };
      },
    },
  });
}

function voiceBody(overrides = {}) {
  return {
    gameTitle: 'client supplied title',
    comment: 'good',
    ...overrides,
  };
}

test('list returns only community records', async () => {
  const service = makeService([record(), record({ id: 'v2', visibility: 'private' })]);
  const output = await service.list({});
  assert.equal(output.length, 1);
  assert.equal(output[0].id, 'v1');
});

test('anonymous records never expose a real name', async () => {
  const service = makeService([record({ anonymous: true })]);
  const [view] = await service.list({});
  assert.equal(view.author.name, undefined);
  assert.equal(view.author.pseudo, 'pseudo-xyz');
  assert.ok(!JSON.stringify(view).includes('Alice'));
});

test('named records resolve the display name', async () => {
  const service = makeService([record()]);
  const [view] = await service.list({});
  assert.equal(view.author.name, 'Alice');
  assert.equal(view.recommend, true);
});

test('records without an author are dropped instead of failing the feed', async () => {
  const service = makeService([
    record({ id: 'v2', userId: undefined, anonymous: true }),
    record(),
  ]);
  const output = await service.list({});
  assert.deepEqual(output.map((view) => view.id), ['v1']);
});

test('one author is resolved once per page', async () => {
  const calls = [];
  const service = makeService([record(), record({ id: 'v2' })], calls);
  const output = await service.list({});
  assert.equal(output.length, 2);
  assert.deepEqual(calls, ['u1']);
});

test('create replaces a submitted title with the active catalog title', async () => {
  const service = makeService([]);

  const saved = await service.create('u1', voiceBody({ gameId: GAME_ID }));

  assert.equal(saved.gameId, GAME_ID);
  assert.equal(saved.gameTitle, 'Uni Quest');
});

test('create refuses missing and inactive catalog games', async () => {
  const serviceWith = (game) => createGlabReviewService({
    voiceStore: { saveVoice: async (value) => value, listVoices: async () => [] },
    resolveDisplayName: async () => 'Alice',
    pseudoId: () => 'pseudo-xyz',
    gameRepository: { findById: async () => game },
  });

  await assert.rejects(
    () => serviceWith(null).create('u1', voiceBody({ gameId: GAME_ID })),
    (error) => error.statusCode === 400 && error.code === 'GAME_NOT_FOUND',
  );
  await assert.rejects(
    () => serviceWith({ id: GAME_ID, title: 'Uni Quest', is_active: false })
      .create('u1', voiceBody({ gameId: GAME_ID })),
    (error) => error.statusCode === 400 && error.code === 'GAME_INACTIVE',
  );
});
