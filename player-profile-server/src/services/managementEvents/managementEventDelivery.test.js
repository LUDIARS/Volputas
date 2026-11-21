const test = require('node:test');
const assert = require('node:assert/strict');
const { createManagementEventDelivery } = require('./managementEventDelivery');
const { postManagementEvent } = require('./managementEventsClient.mjs');

const url = 'http://127.0.0.1:11111/v1/management/events';
const playedAt = '2026-11-21T00:00:00.000Z';
const ai = {
  id: 'aipt_test', run_id: 'run-test', game_id: 'KD', game_title: 'Game', summary: 'Review',
  good: [], bad: [], confusions: [], played_at: playedAt,
};
const human = { id: 'impression-1', game_id: 'KD', captured_at: playedAt };

test('delivery retries network and 5xx after worker re-creation and stops after 2xx or 409', async () => {
  const state = new Map();
  const requests = [];
  const responses = [null, 409, 503, 204];
  const store = {
    async listPendingAi(limit) {
      assert.equal(limit, 25);
      return [undefined, 'pending'].includes(state.get(ai.id)?.state) ? [ai] : [];
    },
    async listPendingHuman() {
      return state.has(human.id) ? [] : [human];
    },
    async recordAttempt(origin, id, result) {
      assert.equal(origin, id === ai.id ? 'ai' : 'human');
      state.set(id, result);
    },
  };
  const deps = {
    store, url, warn() {},
    async fetchImpl(actualUrl, request) {
      assert.equal(actualUrl, url);
      assert.equal(request.method, 'POST');
      assert.equal(request.redirect, 'manual');
      assert.deepEqual(request.headers, { 'Content-Type': 'application/json' });
      requests.push(request.body);
      const status = responses.shift();
      if (status === null) throw new Error('connection failed');
      return new Response(null, { status });
    },
  };

  await createManagementEventDelivery(deps).pushOnce();
  assert.deepEqual(state.get(ai.id), { state: 'pending', status: null });
  assert.deepEqual(state.get(human.id), { state: 'refused', status: 409 });
  const restartedWorker = createManagementEventDelivery(deps);
  await restartedWorker.pushOnce();
  assert.deepEqual(state.get(ai.id), { state: 'pending', status: 503 });
  await restartedWorker.pushOnce();
  assert.deepEqual(state.get(ai.id), { state: 'delivered', status: 204 });
  await restartedWorker.pushOnce();
  assert.equal(requests.length, 4);
  assert.equal(requests[0], requests[2]);
  assert.equal(requests[0], requests[3]);
});

test('all 4xx are terminal and a redirect remains pending without sending to another endpoint', async () => {
  for (const [status, expected] of [[302, 'pending'], [400, 'refused'], [429, 'refused'], [499, 'refused']]) {
    const result = await postManagementEvent({
      url, event: {}, fetchImpl: async () => new Response(null, { status }),
    });
    assert.deepEqual(result, { state: expected, status });
  }
});

test('a DB write failure allows the next impression to be sent', async () => {
  const recorded = [];
  const warnings = [];
  const worker = createManagementEventDelivery({
    url,
    warn: (message) => warnings.push(message),
    fetchImpl: async () => new Response(null, { status: 200 }),
    store: {
      listPendingAi: async () => [ai],
      listPendingHuman: async () => [human],
      async recordAttempt(origin) {
        if (origin === 'ai') throw new Error('database temporarily unavailable');
        recorded.push(origin);
      },
    },
  });
  await worker.pushOnce();
  assert.deepEqual(recorded, ['human']);
  assert.match(warnings.join('\n'), /record_attempt_failed/);
});
