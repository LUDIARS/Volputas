const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createDiscutereImpressionPusher,
  pushPendingImpressions,
  startDiscutereImpressionPush,
  toAnonymousImpression,
} = require('./discutereImpressionPusher');

const BASE_URL = 'https://discutere.example/';
const BEARER = 'service-token-'.padEnd(40, 'x');
const ALLOWED_KEYS = ['comment', 'createdAt', 'gameTitle', 'id', 'polarity', 'recommend'];

function impression(id, extra = {}) {
  return {
    id,
    gameTitle: 'Test Game',
    recommend: true,
    polarity: 'positive',
    comment: `comment ${id}`,
    createdAt: '2026-10-13T00:00:00.000Z',
    ...extra,
  };
}

function okResponse() {
  const body = {
    ok: true,
    received: 1,
    imported: 1,
    embedded: 1,
    games: 1,
    skipped: { non_anonymous_field: 0, invalid: 0 },
  };
  return { ok: true, status: 200, json: async () => body };
}

function harness({
  records = [impression('v1')],
  fetchImpl,
  resolveBearer = async () => BEARER,
  baseUrl = BASE_URL,
} = {}) {
  const calls = [];
  const logs = [];
  const deps = {
    baseUrl,
    listImpressions: async (query) => {
      calls.push({ kind: 'list', query });
      return records;
    },
    resolveBearer,
    fetchImpl: fetchImpl || (async (url, init) => {
      calls.push({ kind: 'fetch', url: String(url), init });
      return okResponse();
    }),
    log: (line) => logs.push(line),
    warn: (line) => logs.push(line),
  };
  return { deps, calls, logs };
}

test('only the six allowlisted fields are kept even when the source carries writer fields', () => {
  const anonymous = toAnonymousImpression(impression('v1', {
    userId: 'user-1',
    pseudoId: 'ext:voluptas:0123456789abcdef',
    displayName: 'Alice',
    cernereSubject: 'sub-1',
    glabProjectId: 'p-1',
  }));
  assert.deepEqual(Object.keys(anonymous).sort(), ALLOWED_KEYS);
  assert.equal(toAnonymousImpression({ id: 'v2' }).polarity, null);
});

test('posts anonymous impressions with the bearer, URL and body Discutere expects', async () => {
  const { deps, calls, logs } = harness({
    records: [impression('v1', { userId: 'user-1', displayName: 'Alice' })],
  });
  const result = await pushPendingImpressions({ ...deps, sentIds: new Set() });

  assert.equal(result.outcome, 'pushed');
  assert.deepEqual(calls[0], { kind: 'list', query: { limit: 200 } });
  const request = calls[1];
  assert.equal(request.url, 'https://discutere.example/api/persona-bridge/impressions');
  assert.equal(request.init.method, 'POST');
  assert.equal(request.init.redirect, 'error');
  assert.equal(request.init.headers.Authorization, `Bearer ${BEARER}`);
  assert.equal(request.init.headers['Content-Type'], 'application/json');
  const body = JSON.parse(request.init.body);
  assert.deepEqual(Object.keys(body), ['impressions']);
  assert.deepEqual(Object.keys(body.impressions[0]).sort(), ALLOWED_KEYS);
  assert.equal(request.init.body.includes('Alice'), false);
  assert.equal(request.init.body.includes('user-1'), false);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].includes(BEARER), false);
  assert.equal(logs[0].includes('comment v1'), false);
});

test('does nothing without a valid Discutere URL or a bearer', async () => {
  const noUrl = harness({ baseUrl: '' });
  assert.equal((await pushPendingImpressions({ ...noUrl.deps, sentIds: new Set() })).outcome, 'not_configured');
  assert.equal(noUrl.calls.length, 0);

  const plainHttp = harness({ baseUrl: 'http://discutere.example/' });
  assert.equal((await pushPendingImpressions({ ...plainHttp.deps, sentIds: new Set() })).outcome, 'not_configured');
  assert.equal(plainHttp.calls.length, 0);

  const noBearer = harness({
    resolveBearer: async () => {
      throw new Error('service token issue failed');
    },
  });
  assert.equal(
    (await pushPendingImpressions({ ...noBearer.deps, sentIds: new Set() })).outcome,
    'bearer_unavailable'
  );
  assert.equal(noBearer.calls.length, 0);
});

test('does not resend ids already pushed by this process and skips empty batches', async () => {
  const { deps, calls } = harness({ records: [impression('v1'), impression('v2')] });
  const pusher = createDiscutereImpressionPusher(deps);

  assert.deepEqual((await pusher.pushOnce()).ids, ['v1', 'v2']);
  assert.equal((await pusher.pushOnce()).outcome, 'nothing_to_push');
  assert.equal(calls.filter((call) => call.kind === 'fetch').length, 1);

  const empty = harness({ records: [] });
  assert.equal((await pushPendingImpressions({ ...empty.deps, sentIds: new Set() })).outcome, 'nothing_to_push');
  assert.equal(empty.calls.filter((call) => call.kind === 'fetch').length, 0);
});

test('failures never throw and the same ids are retried on the next run', async () => {
  const responses = [
    async () => {
      throw new TypeError('fetch failed');
    },
    async () => ({ ok: false, status: 401, json: async () => ({}) }),
    async () => ({ ok: false, status: 403, json: async () => ({}) }),
    async () => ({ ok: false, status: 503, json: async () => ({}) }),
    async () => okResponse(),
  ];
  let attempt = 0;
  const { deps, logs } = harness({ fetchImpl: () => responses[attempt++]() });
  const pusher = createDiscutereImpressionPusher(deps);

  for (const reason of ['unreachable', 'status_401', 'status_403', 'status_503']) {
    const result = await pusher.pushOnce();
    assert.deepEqual({ outcome: result.outcome, reason: result.reason }, { outcome: 'failed', reason });
  }
  assert.deepEqual((await pusher.pushOnce()).ids, ['v1']);
  assert.equal(logs.some((line) => line.includes(BEARER)), false);
});

test('the scheduler runs once right away, never overlaps, and returns a stop function', async () => {
  let runs = 0;
  let release;
  const pusher = {
    pushOnce: () => {
      runs += 1;
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  };
  const stop = startDiscutereImpressionPush({ intervalMinutes: 15, pusher });
  assert.equal(typeof stop, 'function');
  assert.equal(runs, 1);
  release();
  stop();
});
