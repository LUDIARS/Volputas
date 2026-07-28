const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  CernereIntegrationError,
} = require('./cernereErrors');
const {
  CernereProjectSocketClient,
  websocketUrl,
} = require('./projectSocketClient');

class FakeSocket extends EventEmitter {
  constructor({ autoClose = true } = {}) {
    super();
    this.readyState = 0;
    this.sent = [];
    this.autoClose = autoClose;
    this.closeCalls = 0;
    this.terminateCalls = 0;
  }

  send(value) {
    if (this.readyState !== 1) throw new Error('socket is not open');
    this.sent.push(JSON.parse(value));
  }

  close() {
    this.closeCalls += 1;
    if (this.readyState === 3) return;
    if (!this.autoClose) {
      this.readyState = 2;
      return;
    }
    this.finishClose();
  }

  terminate() {
    this.terminateCalls += 1;
    this.finishClose();
  }

  finishClose() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit('close');
  }
}

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

function lifecycleHarness({ requestTimeoutMs = 50, autoClose = true } = {}) {
  const sockets = [];
  let requestNumber = 0;
  const client = new CernereProjectSocketClient({
    baseUrl: 'https://cernere.test',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    openState: 1,
    requestTimeoutMs,
    fetchImpl: async () => Response.json({ accessToken: 'project-token' }),
    createWebSocket: () => {
      const socket = new FakeSocket({ autoClose });
      sockets.push(socket);
      return socket;
    },
    requestId: () => `request-${++requestNumber}`,
  });
  return { client, sockets };
}

async function authenticate(socket) {
  socket.readyState = 1;
  socket.emit('message', JSON.stringify({ type: 'connected' }));
  await tick();
}

function clientHarness({ requestTimeoutMs } = {}) {
  let resolveSocket;
  const socketCreated = new Promise((resolve) => { resolveSocket = resolve; });
  let loginRequest;
  let protocols;
  let socketOptions;
  const client = new CernereProjectSocketClient({
    baseUrl: 'https://cernere.test/base',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    openState: 1,
    ...(requestTimeoutMs ? { requestTimeoutMs } : {}),
    requestId: () => 'volputas-request-1',
    fetchImpl: async (url, init) => {
      loginRequest = { url, init };
      return Response.json({ accessToken: 'project-token' });
    },
    createWebSocket: (url, values, options) => {
      const socket = new FakeSocket();
      socket.url = url;
      protocols = values;
      socketOptions = options;
      resolveSocket(socket);
      return socket;
    },
  });
  return {
    client,
    socketCreated,
    getLoginRequest: () => loginRequest,
    getProtocols: () => protocols,
    getSocketOptions: () => socketOptions,
  };
}

test('logs in, authenticates by WebSocket subprotocol, and correlates responses', async () => {
  const harness = clientHarness();
  const responsePromise = harness.client.request(
    'volputas_survey',
    'get_response',
    { userId: 'user', surveyId: 'survey' },
  );
  const socket = await harness.socketCreated;
  socket.readyState = 1;
  socket.emit('message', JSON.stringify({ type: 'connected' }));

  await new Promise((resolve) => setImmediate(resolve));
  const login = harness.getLoginRequest();
  assert.equal(login.url, 'https://cernere.test/base/api/auth/login');
  assert.deepEqual(JSON.parse(login.init.body), {
    grant_type: 'project_credentials',
    client_id: 'client-id',
    client_secret: 'client-secret',
  });
  assert.equal(login.init.redirect, 'error');
  assert.deepEqual(harness.getProtocols(), ['bearer', 'project-token']);
  assert.deepEqual(harness.getSocketOptions(), { maxPayload: 2 * 1024 * 1024 });
  assert.equal(socket.url, 'wss://cernere.test/base/ws/project');

  const request = socket.sent.find((message) => message.type === 'module_request');
  assert.equal(request.request_id, 'volputas-request-1');
  socket.emit('message', JSON.stringify({
    type: 'module_response',
    request_id: request.request_id,
    payload: { ok: true },
  }));
  assert.deepEqual(await responsePromise, { ok: true });
  await harness.client.close();
});

test('responds to ping and rejects pending work on protocol failure', async () => {
  const harness = clientHarness();
  const pending = harness.client.request('volputas_survey', 'get_response', {});
  const socket = await harness.socketCreated;
  socket.readyState = 1;
  socket.emit('message', JSON.stringify({ type: 'connected' }));
  await new Promise((resolve) => setImmediate(resolve));

  socket.emit('message', JSON.stringify({ type: 'ping', ts: 42 }));
  assert.deepEqual(socket.sent.find((message) => message.type === 'pong'), {
    type: 'pong',
    ts: 42,
  });

  socket.emit('message', '{broken-json');
  await assert.rejects(pending, CernereIntegrationError);
  assert.equal(socket.readyState, 3);
  await harness.client.close();
});

test('rejects correlated server errors and pending work when the socket closes', async () => {
  const harness = clientHarness();
  const failedCommand = harness.client.request('volputas_survey', 'get_response', {});
  const socket = await harness.socketCreated;
  socket.readyState = 1;
  socket.emit('message', JSON.stringify({ type: 'connected' }));
  await new Promise((resolve) => setImmediate(resolve));

  socket.emit('message', JSON.stringify({
    type: 'error',
    request_id: 'volputas-request-1',
    code: 'command_error',
    message: 'must not be reflected',
  }));
  await assert.rejects(failedCommand, CernereIntegrationError);

  const pendingAtClose = harness.client.request(
    'volputas_survey',
    'get_response',
    {},
  );
  await new Promise((resolve) => setImmediate(resolve));
  socket.close();
  await assert.rejects(pendingAtClose, CernereIntegrationError);
  await harness.client.close();
});

test('times out an unanswered project command and releases its pending entry', async () => {
  const harness = clientHarness({ requestTimeoutMs: 50 });
  const pending = harness.client.request('volputas_survey', 'get_response', {});
  const socket = await harness.socketCreated;
  socket.readyState = 1;
  socket.emit('message', JSON.stringify({ type: 'connected' }));

  await assert.rejects(pending, /timed out/);
  assert.equal(harness.client.pending.size, 0);
  await harness.client.close();
});

test('builds a ws/wss URL without putting credentials in the query', () => {
  assert.equal(
    websocketUrl('http://localhost/base'),
    'ws://localhost/base/ws/project',
  );
  assert.equal(
    websocketUrl('https://cernere.test'),
    'wss://cernere.test/ws/project',
  );
});

test('terminal shutdown aborts an in-flight login before a socket is created', async () => {
  const secret = 'client-secret-canary';
  let loginSignal;
  let markLoginStarted;
  const loginStarted = new Promise((resolve) => {
    markLoginStarted = resolve;
  });
  let socketCount = 0;
  const client = new CernereProjectSocketClient({
    baseUrl: 'https://cernere.test',
    clientId: 'client-id',
    clientSecret: secret,
    openState: 1,
    fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
      loginSignal = init.signal;
      markLoginStarted();
      init.signal.addEventListener('abort', () => {
        reject(new Error(`aborted ${secret}`));
      }, { once: true });
    }),
    createWebSocket: () => {
      socketCount += 1;
      return new FakeSocket();
    },
  });

  const request = client.request('volputas_survey', 'get_response', {});
  const rejectedRequest = assert.rejects(
    request,
    (error) => error instanceof CernereIntegrationError
      && /client is closed/.test(error.message)
      && !error.message.includes(secret),
  );
  await loginStarted;
  await client.close();
  await rejectedRequest;

  assert.equal(loginSignal.aborted, true);
  assert.equal(socketCount, 0);
});

test('terminal shutdown closes a socket still authenticating', async () => {
  let socket;
  const client = new CernereProjectSocketClient({
    baseUrl: 'https://cernere.test',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    openState: 1,
    fetchImpl: async () => Response.json({ accessToken: 'project-token' }),
    createWebSocket: () => {
      socket = new FakeSocket({ autoClose: false });
      return socket;
    },
  });

  const request = client.request('volputas_survey', 'get_response', {});
  const rejectedRequest = assert.rejects(request, /client is closed/);
  while (!socket) await new Promise((resolve) => setImmediate(resolve));

  let closeSettled = false;
  const closePromise = client.close().then(() => {
    closeSettled = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(socket.closeCalls, 1);
  assert.equal(closeSettled, false);
  socket.finishClose();

  await closePromise;
  await rejectedRequest;
  assert.equal(client.pending.size, 0);
});

test('authentication timeouts terminate every superseded closing socket', async () => {
  const sockets = [];
  const client = new CernereProjectSocketClient({
    baseUrl: 'https://cernere.test',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    openState: 1,
    requestTimeoutMs: 25,
    fetchImpl: async () => Response.json({ accessToken: 'project-token' }),
    createWebSocket: () => {
      const socket = new FakeSocket({ autoClose: false });
      sockets.push(socket);
      return socket;
    },
  });

  const firstRequest = client.request('volputas_survey', 'get_response', {});
  while (sockets.length < 1) await new Promise((resolve) => setImmediate(resolve));
  sockets[0].readyState = 1;
  await assert.rejects(firstRequest, /authentication timed out/);

  const secondRequest = client.request('volputas_survey', 'get_response', {});
  while (sockets.length < 2) await new Promise((resolve) => setImmediate(resolve));
  sockets[1].readyState = 1;
  await assert.rejects(secondRequest, /authentication timed out/);

  await client.close();

  assert.deepEqual(
    sockets.map((socket) => ({
      closeCalls: socket.closeCalls,
      terminateCalls: socket.terminateCalls,
      readyState: socket.readyState,
    })),
    [
      { closeCalls: 1, terminateCalls: 1, readyState: 3 },
      { closeCalls: 1, terminateCalls: 1, readyState: 3 },
    ],
  );
  assert.equal(client.connections.size, 0);
});

test('close waits for the active socket and permanently rejects new requests', async () => {
  let socket;
  const client = new CernereProjectSocketClient({
    baseUrl: 'https://cernere.test',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    openState: 1,
    fetchImpl: async () => Response.json({ accessToken: 'project-token' }),
    createWebSocket: () => {
      socket = new FakeSocket({ autoClose: false });
      return socket;
    },
    requestId: () => 'request-before-close',
  });

  const firstRequest = client.request('volputas_survey', 'get_response', {});
  while (!socket) await new Promise((resolve) => setImmediate(resolve));
  socket.readyState = 1;
  socket.emit('message', JSON.stringify({ type: 'connected' }));
  await new Promise((resolve) => setImmediate(resolve));
  socket.emit('message', JSON.stringify({
    type: 'module_response',
    request_id: 'request-before-close',
    payload: { ok: true },
  }));
  await firstRequest;

  let closeSettled = false;
  const closePromise = client.close().then(() => {
    closeSettled = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(socket.closeCalls, 1);
  assert.equal(closeSettled, false);
  socket.finishClose();
  await closePromise;
  assert.equal(closeSettled, true);

  await assert.rejects(
    client.request('volputas_survey', 'get_response', { secret: 'must-not-leak' }),
    (error) => error instanceof CernereIntegrationError
      && error.message === 'Cernere project client is closed'
      && !error.message.includes('must-not-leak'),
  );
});

test('stale socket error and close events cannot reject a newer generation', async () => {
  const sockets = [];
  let requestNumber = 0;
  const client = new CernereProjectSocketClient({
    baseUrl: 'https://cernere.test',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    openState: 1,
    fetchImpl: async () => Response.json({ accessToken: 'project-token' }),
    createWebSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    requestId: () => `request-${++requestNumber}`,
  });

  const firstRequest = client.request('volputas_survey', 'get_response', {});
  while (sockets.length < 1) await new Promise((resolve) => setImmediate(resolve));
  const firstSocket = sockets[0];
  firstSocket.readyState = 1;
  firstSocket.emit('message', JSON.stringify({ type: 'connected' }));
  await new Promise((resolve) => setImmediate(resolve));
  firstSocket.emit('message', JSON.stringify({
    type: 'module_response',
    request_id: 'request-1',
    payload: { generation: 1 },
  }));
  assert.deepEqual(await firstRequest, { generation: 1 });
  firstSocket.finishClose();

  const secondRequest = client.request('volputas_survey', 'get_response', {});
  while (sockets.length < 2) await new Promise((resolve) => setImmediate(resolve));
  const secondSocket = sockets[1];
  secondSocket.readyState = 1;
  secondSocket.emit('message', JSON.stringify({ type: 'connected' }));
  await new Promise((resolve) => setImmediate(resolve));

  firstSocket.emit('error', new Error('stale-socket-secret'));
  firstSocket.emit('close');
  secondSocket.emit('message', JSON.stringify({
    type: 'module_response',
    request_id: 'request-2',
    payload: { generation: 2 },
  }));

  assert.deepEqual(await secondRequest, { generation: 2 });
  await client.close();
});

test('serializes a burst of concurrent start and stop calls', async () => {
  const { client, sockets } = lifecycleHarness();
  const starts = [client.start(), client.start(), client.start()];
  const stops = [client.close(), client.close()];

  const settledStops = await Promise.all(stops);
  assert.deepEqual(settledStops, [undefined, undefined]);

  for (const start of starts) {
    await assert.rejects(start, (error) => (
      error instanceof CernereIntegrationError && /client is closed/.test(error.message)
    ));
  }

  assert.ok(sockets.length <= 1, `at most one socket may be created, saw ${sockets.length}`);
  for (const socket of sockets) assert.equal(socket.readyState, 3);
  assert.equal(client.connections.size, 0);
  assert.equal(client.connection, null);
  assert.equal(client.pending.size, 0);
});

test('a stop racing an in-flight start leaves no orphan socket behind', async () => {
  const { client, sockets } = lifecycleHarness();
  const firstStart = client.start();
  while (sockets.length < 1) await tick();

  const stop = client.close();
  const restart = client.start();

  await assert.rejects(firstStart, /client is closed/);
  await assert.rejects(restart, /client is closed/);
  await stop;

  assert.equal(sockets.length, 1);
  assert.equal(sockets[0].readyState, 3);
  assert.equal(client.connections.size, 0);
  assert.equal(client.connection, null);
  assert.equal(client.pending.size, 0);
});

test('retires a timed-out connection and reconnects on the next request', async () => {
  const { client, sockets } = lifecycleHarness({ requestTimeoutMs: 50 });

  const timedOut = client.request('volputas_survey', 'get_response', {});
  while (sockets.length < 1) await tick();
  await authenticate(sockets[0]);
  await assert.rejects(timedOut, /timed out/);

  // The half-open socket must not be handed to the next caller.
  assert.equal(client.connection, null);
  assert.equal(sockets[0].readyState, 3);
  assert.equal(client.pending.size, 0);

  const retried = client.request('volputas_survey', 'get_response', {});
  while (sockets.length < 2) await tick();
  assert.notEqual(sockets[1], sockets[0]);
  await authenticate(sockets[1]);

  const sent = sockets[1].sent.find((message) => message.type === 'module_request');
  assert.ok(sent, 'the retried request is sent on the fresh socket');
  sockets[1].emit('message', JSON.stringify({
    type: 'module_response',
    request_id: sent.request_id,
    payload: { reconnected: true },
  }));
  assert.deepEqual(await retried, { reconnected: true });
  await client.close();
});

test('a retired generation cannot settle a newer generation pending request', async () => {
  const { client, sockets } = lifecycleHarness({ requestTimeoutMs: 60, autoClose: false });

  const timedOut = client.request('volputas_survey', 'get_response', {});
  while (sockets.length < 1) await tick();
  await authenticate(sockets[0]);
  await assert.rejects(timedOut, /timed out/);
  assert.equal(client.connection, null);

  const fresh = client.request('volputas_survey', 'get_response', {});
  while (sockets.length < 2) await tick();
  await authenticate(sockets[1]);
  assert.equal(client.pending.size, 1);

  // The retired socket replays late traffic that reuses the new request id.
  sockets[0].emit('message', JSON.stringify({
    type: 'module_response',
    request_id: 'request-2',
    payload: { from: 'stale-generation' },
  }));
  sockets[0].emit('message', JSON.stringify({
    type: 'error',
    request_id: 'request-2',
    code: 'stale',
  }));
  sockets[0].emit('close');
  await tick();
  assert.equal(client.pending.size, 1, 'stale traffic must not settle the new pending request');

  sockets[1].emit('message', JSON.stringify({
    type: 'module_response',
    request_id: 'request-2',
    payload: { from: 'current-generation' },
  }));
  assert.deepEqual(await fresh, { from: 'current-generation' });
  await client.close();
});
