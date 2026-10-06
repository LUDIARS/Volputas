const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createImpressionExportRouter } = require('./impressionExport');
const { createGlabReviewService } = require('../services/glabReviewService');

function record(overrides = {}) {
  return {
    id: 'v1',
    userId: 'u1',
    displayName: '本名太郎',
    gameTitle: 'モンスターストライク',
    recommend: true,
    polarity: 'positive',
    comment: '周回が気持ちいい',
    glabProjectId: 'p1',
    visibility: 'community',
    anonymous: false,
    createdAt: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

function makeService(records) {
  return createGlabReviewService({
    voiceStore: {
      listVoices: async ({ limit, offset }) => records.slice(offset, offset + limit),
      saveVoice: async () => null,
    },
    resolveDisplayName: async () => 'name',
    pseudoId: (id) => `pseudo-${id}`,
    gameRepository: {},
  });
}

test('listImpressions returns only community impressions without any author fields', async () => {
  const service = makeService([
    record(),
    record({ id: 'v2', visibility: 'private' }),
    record({ id: 'v3', comment: '   ' }),
    record({ id: 'v4', gameTitle: 'パズル&ドラゴンズ', comment: 'パズルが楽しい' }),
  ]);
  const all = await service.listImpressions({});
  assert.deepEqual(all.map((i) => i.id), ['v1', 'v4']);
  for (const impression of all) {
    assert.deepEqual(
      Object.keys(impression).sort(),
      ['comment', 'createdAt', 'gameTitle', 'id', 'polarity', 'recommend'],
      'author / userId / displayName / glabProjectId must not leak',
    );
  }
});

test('listImpressions filters by game title in both directions and respects limit', async () => {
  const service = makeService([
    record(),
    record({ id: 'v2', gameTitle: 'モンスターストライク 2', comment: '新作' }),
    record({ id: 'v3', gameTitle: 'パズル&ドラゴンズ' }),
  ]);
  assert.deepEqual((await service.listImpressions({ game: 'モンスター ストライク' })).map((i) => i.id), ['v1', 'v2']);
  assert.deepEqual((await service.listImpressions({ game: 'モンスターストライク の周回' })).map((i) => i.id), ['v1']);
  assert.deepEqual((await service.listImpressions({ game: 'モンスターストライク', limit: 1 })).map((i) => i.id), ['v1']);
});

test('impression export route authenticates and validates limit', async (t) => {
  const calls = [];
  const app = express();
  app.use('/api/personas/impressions', createImpressionExportRouter({
    authenticateMiddleware: (req, res, next) => (
      req.headers.authorization === 'Bearer ok' ? next() : res.status(401).json({ ok: false })
    ),
    serviceProvider: () => ({
      listImpressions: async (input) => {
        calls.push(input);
        return [{ id: 'v1', gameTitle: 'g', recommend: true, polarity: null, comment: 'c', createdAt: 'x' }];
      },
    }),
  }));
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/personas/impressions`;

  assert.equal((await fetch(base)).status, 401, 'unauthenticated requests are rejected');
  const bad = await fetch(`${base}?limit=999`, { headers: { authorization: 'Bearer ok' } });
  assert.equal(bad.status, 400);
  const ok = await fetch(`${base}?game=%E3%83%A2%E3%83%B3%E3%82%B9%E3%83%88&limit=10`, {
    headers: { authorization: 'Bearer ok' },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('cache-control'), 'private, no-store');
  const body = await ok.json();
  assert.equal(body.data.impressions.length, 1);
  assert.deepEqual(calls, [{ game: 'モンスト', limit: 10 }]);
});
