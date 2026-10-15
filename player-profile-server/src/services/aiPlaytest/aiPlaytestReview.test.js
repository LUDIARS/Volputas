const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { normalizeAiPlaytestReview } = require('./aiPlaytestReviewInput');
const { createAiPlaytestReviewService, reviewIdFor } = require('./aiPlaytestReviewService');
const { LocalAiPlaytestReviewStore } = require('../../local/localAiPlaytestReviewStore');

function body(overrides = {}) {
  return {
    format: 'ai-playtest-review/1',
    source: 'ai-autoplayer',
    game_id: 'bestia',
    game_title: 'Bestia',
    run_id: 'playtest:bestia-novice-s1-20261015T000000Z',
    persona: 'novice',
    engine_version: '0.2.0',
    adapter: 'sim:bestia',
    screen: 'text',
    ticks: 40,
    turns: 3,
    outcome: 'success',
    summary: '攻撃の流れは分かりやすいが体力の減り方が読みにくい。',
    good: [{ aspect: 'control', text: '攻撃が素直に当たる。', evidence: { ticks: [0], shots: [1] } }],
    bad: [{ aspect: 'ux', text: '体力の減りが画面から分かりにくい。', evidence: { ticks: [5], shots: [2] } }],
    confusions: [],
    reflection: ['敵の位置を確かめる前に動いた。'],
    created_at: '2026-10-15T00:00:00.000Z',
    ...overrides,
  };
}

function memoryStore() {
  const records = new Map();
  return {
    records,
    async save(record) {
      const existing = [...records.values()].find((item) => item.runId === record.runId);
      if (existing) return { record: existing, created: false };
      records.set(record.id, record);
      return { record, created: true };
    },
    async list({ limit }) {
      return [...records.values()].slice(0, limit);
    },
  };
}

test('a review needs both good and bad points', () => {
  assert.equal(normalizeAiPlaytestReview(body()).good.length, 1);
  assert.throws(() => normalizeAiPlaytestReview(body({ bad: [] })), /bad needs at least one point/);
  assert.throws(() => normalizeAiPlaytestReview(body({ good: [] })), /good needs at least one point/);
});

test('fields that identify a writer (or any unknown field) are refused, at every level', () => {
  assert.throws(() => normalizeAiPlaytestReview(body({ operator: 'someone' })), /not accepted: operator/);
  assert.throws(() => normalizeAiPlaytestReview(body({ userId: 'u1' })), /not accepted: userId/);
  const point = { aspect: 'ux', text: 'x', evidence: { ticks: [], shots: [], machine: 'PC-1' } };
  assert.throws(() => normalizeAiPlaytestReview(body({ bad: [point] })), /not accepted: machine/);
  assert.throws(() => normalizeAiPlaytestReview(body({ source: 'human' })), /source must be ai-autoplayer/);
});

test('the service saves once per run_id and needs Idempotency-Key = run_id', async () => {
  const store = memoryStore();
  const service = createAiPlaytestReviewService({ store, now: () => new Date('2026-10-15T01:00:00Z') });
  const first = await service.create({ idempotencyKey: body().run_id, body: body() });
  const again = await service.create({ idempotencyKey: body().run_id, body: body() });
  assert.deepEqual([first.created, again.created], [true, false]);
  assert.equal(first.review.id, reviewIdFor(body().run_id));
  assert.equal(first.review.source, 'ai-autoplayer');
  assert.equal(Object.keys(first.review).some((key) => /user|author|name|pseudo/i.test(key)), false);
  await assert.rejects(service.create({ idempotencyKey: 'other', body: body() }), /Idempotency-Key must equal run_id/);
});

test('the list filters by game title or game id and checks its limit', async () => {
  const store = memoryStore();
  const service = createAiPlaytestReviewService({ store });
  await service.create({ idempotencyKey: body().run_id, body: body() });
  await service.create({ idempotencyKey: 'run-2', body: body({ run_id: 'run-2', game_id: 'kd', game_title: 'KonbiniDominant' }) });
  assert.deepEqual((await service.list({ game: 'konbini' })).map((review) => review.gameId), ['kd']);
  assert.deepEqual((await service.list({ game: 'bestia' })).map((review) => review.gameId), ['bestia']);
  assert.equal((await service.list({})).length, 2);
  await assert.rejects(service.list({ limit: 0 }), /limit must be 1-200/);
});

test('the local store writes ai-playtests/<id>.json outside any respondent folder and never overwrites', async () => {
  const repositoryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'voluptas-aipt-'));
  try {
    const store = new LocalAiPlaytestReviewStore();
    const service = createAiPlaytestReviewService({ store });
    const created = await service.create({ idempotencyKey: body().run_id, body: body(), context: { repositoryRoot } });
    const again = await service.create({ idempotencyKey: body().run_id, body: body({ summary: '別の総評' }), context: { repositoryRoot } });
    assert.equal(again.created, false);
    assert.equal(again.review.summary, created.review.summary, 'the first record is kept');
    assert.deepEqual(await fs.readdir(repositoryRoot), ['ai-playtests']);
    assert.deepEqual(await fs.readdir(path.join(repositoryRoot, 'ai-playtests')), [`${created.review.id}.json`]);
    assert.equal((await service.list({ context: { repositoryRoot } })).length, 1);
  } finally {
    await fs.rm(repositoryRoot, { recursive: true, force: true });
  }
});
