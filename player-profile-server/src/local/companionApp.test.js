const test = require('node:test');
const assert = require('node:assert/strict');
const { CapturePairing } = require('../services/captureSession/capturePairing');
const { CaptureSessionService } = require('../services/captureSession/captureSessionService');
const { createCompanionApp } = require('./companionApp');
const { readCompanionConfig, companionStatus } = require('./companionListener');

const CONTEXT = { repositoryRoot: '/repo', name: 'tester' };

function inMemoryService() {
  const records = new Map();
  let sequence = 0;
  const service = new CaptureSessionService({
    recordStore: {
      async list() { return [...records.values()]; },
      async write({ data }) {
        const id = data.id || `record-${(sequence += 1)}`;
        const record = { schemaVersion: 1, ...data, id };
        records.set(id, record);
        return { filePath: `/repo/${id}.json`, record };
      },
    },
    gazeLog: {
      appended: [],
      async append(_context, samples) { this.appended.push(...samples); },
      async read() { return []; },
    },
    audioStore: {
      async save({ sessionId, contentType }) {
        return { fileName: `${sessionId}.webm`, bytes: 1, contentType };
      },
      async resolve() { return null; },
    },
    pairing: new CapturePairing(),
  });
  return service;
}

async function startedApp(t) {
  const service = inMemoryService();
  await service.start(CONTEXT, { gameTitle: 'X', gameClockMs: null }, 'manual');
  const server = createCompanionApp({ captureSessionService: service }).listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { service, origin };
}

async function postJson(url, body, token) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, payload: await response.json() };
}

test('the companion page is served without a token', async (t) => {
  const { origin } = await startedApp(t);
  const response = await fetch(origin);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Volputas Capture Companion/);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const nonce = html.match(/<script nonce="([^"]+)">/)?.[1];
  assert.ok(nonce, 'the inline companion script has a nonce');
  assert.ok(
    response.headers.get('content-security-policy').includes(`'nonce-${nonce}'`),
    'Helmet allows exactly the nonce attached to the inline script'
  );
});

test('join exchanges a pairing code for a token; bad codes are 401', async (t) => {
  const { service, origin } = await startedApp(t);
  const { code } = await service.issuePairing();
  const joined = await postJson(`${origin}/api/join`, { code });
  assert.equal(joined.status, 201);
  assert.equal(joined.payload.data.session.gameTitle, 'X');

  const rejected = await postJson(`${origin}/api/join`, { code: '000000' });
  assert.equal(rejected.status, 401);
  assert.equal(rejected.payload.error.code, 'INVALID_PAIRING_CODE');
});

test('malformed JSON is rejected without an Express error page', async (t) => {
  const { origin } = await startedApp(t);
  const response = await fetch(`${origin}/api/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{',
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: { code: 'INVALID_JSON', message: 'Malformed JSON request body' },
  });
});

test('token-guarded endpoints reject missing tokens and accept gaze batches', async (t) => {
  const { service, origin } = await startedApp(t);
  const denied = await postJson(`${origin}/api/gaze`, { samples: [] });
  assert.equal(denied.status, 401);

  const { code } = await service.issuePairing();
  const { token } = (await postJson(`${origin}/api/join`, { code })).payload.data;

  const synced = await postJson(`${origin}/api/sync`, { clientSentAtMs: 5 }, token);
  assert.equal(synced.status, 200);
  assert.equal(typeof synced.payload.data.sessionMs, 'number');

  const gaze = await postJson(`${origin}/api/gaze`, {
    samples: [{ sessionMs: 100, x: 0.5, y: 0.5 }],
  }, token);
  assert.equal(gaze.status, 202);
  assert.deepEqual(gaze.payload.data, { accepted: 1, total: 1 });

  const marker = await postJson(`${origin}/api/markers`, { type: 'hype' }, token);
  assert.equal(marker.status, 201);

  const state = await fetch(`${origin}/api/session`, {
    headers: { authorization: `Bearer ${token}` },
  }).then((response) => response.json());
  assert.equal(state.data.status, 'recording');
});

test('unexpected companion failures do not disclose local paths', async (t) => {
  const { service, origin } = await startedApp(t);
  const { code } = await service.issuePairing();
  const { token } = (await postJson(`${origin}/api/join`, { code })).payload.data;
  service.gazeLog.append = async () => {
    throw new Error('EACCES: C:\\private\\VolputasData');
  };

  const failed = await postJson(`${origin}/api/gaze`, {
    samples: [{ sessionMs: 100, x: 0.5, y: 0.5 }],
  }, token);
  assert.equal(failed.status, 500);
  assert.equal(failed.payload.error.code, 'COMPANION_OPERATION_FAILED');
  assert.doesNotMatch(JSON.stringify(failed.payload), /private|VolputasData/);
});

test('audio upload streams to the store and updates the record', async (t) => {
  const { service, origin } = await startedApp(t);
  const { code } = await service.issuePairing();
  const { token } = (await postJson(`${origin}/api/join`, { code })).payload.data;
  await service.stop();

  const response = await fetch(`${origin}/api/audio`, {
    method: 'PUT',
    headers: {
      'content-type': 'audio/webm',
      'x-audio-duration-seconds': '12',
      authorization: `Bearer ${token}`,
    },
    body: Buffer.from('webm-bytes'),
  });
  assert.equal(response.status, 201);
  const records = await service.list(CONTEXT);
  assert.match(records[0].capture.audioFileName, /\.webm$/);
  assert.equal(records[0].capture.audioDurationSeconds, 12);
});

test('pairing attempts are rate limited per LAN client', async (t) => {
  const { origin } = await startedApp(t);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const rejected = await postJson(`${origin}/api/join`, { code: '000000' });
    assert.equal(rejected.status, 401);
  }
  const limited = await postJson(`${origin}/api/join`, { code: '000000' });
  assert.equal(limited.status, 429);
  assert.equal(limited.payload.error.code, 'PAIRING_RATE_LIMITED');
});

test('companion listener config is opt-in and fail-fast on bad values', () => {
  assert.equal(readCompanionConfig({}), null);
  assert.deepEqual(
    readCompanionConfig({
      VOLPUTAS_COMPANION_PORT: '58080',
      VOLPUTAS_COMPANION_HOST: '127.0.0.1',
    }),
    { port: 58080, host: '127.0.0.1', tls: null }
  );
  assert.throws(
    () => readCompanionConfig({ VOLPUTAS_COMPANION_PORT: '58080' }),
    /TLS certificate and key are required/
  );
  assert.throws(() => readCompanionConfig({ VOLPUTAS_COMPANION_PORT: 'games' }), /valid TCP port/);
  assert.throws(
    () => readCompanionConfig({
      VOLPUTAS_COMPANION_PORT: '58080',
      VOLPUTAS_COMPANION_TLS_CERT_FILE: 'cert.pem',
    }),
    /must be set together/
  );
  assert.deepEqual(companionStatus(null), { enabled: false });
  const status = companionStatus({ port: 58080, host: '127.0.0.1', tls: null });
  assert.equal(status.enabled, true);
  assert.equal(status.secure, false);
  assert.deepEqual(status.urls, ['http://127.0.0.1:58080/']);
  assert.deepEqual(
    companionStatus({ port: 58080, host: '::1', tls: null }).urls,
    ['http://[::1]:58080/']
  );
});
