const test = require('node:test');
const assert = require('node:assert/strict');
const { createDiscutereAiPlaytestDelivery } = require('./discutereAiPlaytestDelivery');

const review = {
  id: 'aipt_test',
  runId: 'run-test',
  gameId: 'bestia',
  gameTitle: 'Bestia',
  summary: 'The control felt responsive.',
  good: [{ aspect: 'control', text: 'Responsive', evidence: { ticks: [1], shots: [] } }],
  bad: [{ aspect: 'ux', text: 'Feedback was unclear', evidence: { ticks: [2], shots: [] } }],
  confusions: [],
  reflection: ['Try reading the health bar first.'],
  playedAt: '2026-11-21T00:00:00.000Z',
  userId: 'do-not-export',
};

function fixture(fetchImpl, overrides = {}) {
  const warnings = [];
  const attempts = [];
  const store = {
    async listPendingDelivery() {
      return attempts.some(({ result }) => result.delivered) ? [] : [review];
    },
    async recordDeliveryAttempt(runId, result) {
      attempts.push({ runId, result });
    },
  };
  const deps = {
    baseUrl: 'https://discutere.example/',
    resolveBearer: async () => 'mock-bridge-token',
    fetchImpl,
    store,
    warn: (message) => warnings.push(message),
    ...overrides,
  };
  return { delivery: createDiscutereAiPlaytestDelivery(deps), deps, warnings, attempts };
}

test('the AI payload goes to its own bridge endpoint and a matching receipt prevents subsequent sends', async () => {
  const requests = [];
  const { delivery, deps, attempts } = fixture(async (url, init) => {
    requests.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
    assert.equal(init.redirect, 'error');
    return Response.json({ ok: true, run_id: review.runId }, { status: 201 });
  });
  assert.deepEqual(await delivery.pushOnce(), { delivered: 1 });
  assert.deepEqual(await createDiscutereAiPlaytestDelivery(deps).pushOnce(), { delivered: 0 });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://discutere.example/api/persona-bridge/ai-playtest-reviews');
  assert.equal(requests[0].headers.Authorization, 'Bearer mock-bridge-token');
  assert.equal(requests[0].headers['Idempotency-Key'], review.runId);
  assert.deepEqual(requests[0].body, {
    origin: 'ai', source: 'ai-autoplayer', run_id: review.runId, game_id: review.gameId,
    game_title: review.gameTitle, summary: review.summary, good: review.good, bad: review.bad,
    confusions: review.confusions, reflection: review.reflection, played_at: review.playedAt,
  });
  assert.equal(attempts[0].runId, review.runId);
});

test('failed and ambiguous responses stay pending and are retried with the same run key', async () => {
  const responses = [
    () => { throw new Error('network error'); },
    () => new Response(null, { status: 503 }),
    () => new Response('not JSON'),
    () => Response.json({ ok: true, run_id: 'wrong-run' }),
    () => Response.json({ ok: true, run_id: review.runId }),
  ];
  const keys = [];
  const { delivery, attempts, warnings } = fixture(async (_url, init) => {
    keys.push(init.headers['Idempotency-Key']);
    return responses.shift()();
  });
  for (const reason of ['unreachable', 'status_503', 'invalid_json', 'invalid_acknowledgment']) {
    assert.deepEqual(await delivery.pushOnce(), { delivered: 0 });
    assert.deepEqual(attempts.at(-1), { runId: review.runId, result: { delivered: false, reason } });
    assert.match(warnings.at(-1), new RegExp(reason));
  }
  assert.deepEqual(await delivery.pushOnce(), { delivered: 1 });
  assert.deepEqual(keys, Array(5).fill(review.runId));
});

test('missing or invalid bridge configuration leaves the row pending and logs why', async () => {
  for (const [overrides, reason] of [
    [{ baseUrl: null }, 'base_url_missing'],
    [{ baseUrl: 'http://discutere.example/' }, 'base_url_invalid'],
    [{ resolveBearer: async () => { throw new Error('token issue'); } }, 'bearer_unavailable'],
  ]) {
    let requests = 0;
    const { delivery, attempts, warnings } = fixture(async () => { requests += 1; }, overrides);
    assert.deepEqual(await delivery.pushOnce(), { delivered: 0, reason });
    assert.equal(requests, 0);
    assert.deepEqual(attempts, []);
    assert.match(warnings[0], new RegExp(reason));
  }
});

test('a bridge receipt is retried if the local acknowledgment could not be saved', async () => {
  const keys = [];
  const { delivery, deps, warnings } = fixture(async (_url, init) => {
    keys.push(init.headers['Idempotency-Key']);
    return Response.json({ ok: true, run_id: review.runId });
  });
  const saveAttempt = deps.store.recordDeliveryAttempt;
  deps.store.recordDeliveryAttempt = async () => { throw new Error('database unavailable'); };
  assert.deepEqual(await delivery.pushOnce(), { delivered: 0 });
  assert.match(warnings[0], /record_attempt_failed/);
  deps.store.recordDeliveryAttempt = saveAttempt;
  assert.deepEqual(await delivery.pushOnce(), { delivered: 1 });
  assert.deepEqual(keys, [review.runId, review.runId]);
});
