const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { WebSocket } = require('ws');
const { createPlayStreamSocket, PLAY_STREAM_SOCKET_PATH } = require('./playStreamSocket');
const { createPlayStreamRecorder } = require('./playStreamRecorder');
const { createPlayStreamRouter } = require('./playStreamRoutes');
const { createMemoryPlayStreamStore } = require('./memoryPlayStreamStore.testHelper');
const { SESSION_ID, USER, startFrame, trialFrame, endFrame } = require('./playStreamFrames.testHelper');

const ALLOWED_ORIGIN = 'http://localhost:5381';

async function startServer({ maxConnections = 4 } = {}) {
  const store = createMemoryPlayStreamStore();
  const config = { allowedOrigins: [ALLOWED_ORIGIN], maxConnections };
  const resolveUserId = async () => USER;
  const socket = createPlayStreamSocket({ config, recorder: createPlayStreamRecorder({ store }), resolveUserId });
  const app = express();
  app.use('/api/v1/play-stream', createPlayStreamRouter({ config, store, resolveUserId }));
  const server = http.createServer(app);
  server.on('upgrade', (request, raw, head) => {
    if (!socket.handleUpgrade(request, raw, head)) raw.destroy();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    store,
    port,
    async close() {
      socket.close();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/** 接続し、開いたら ws を、断られたら HTTP ステータスを返す。 */
function connect(port, { path = PLAY_STREAM_SOCKET_PATH, origin } = {}) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, origin ? { origin } : {});
    ws.on('open', () => resolve({ ws }));
    ws.on('unexpected-response', (_request, response) => resolve({ status: response.statusCode }));
    ws.on('error', () => resolve({ status: 0 }));
  });
}

function collectReplies(ws, count) {
  return new Promise((resolve) => {
    const replies = [];
    ws.on('message', (data) => {
      replies.push(JSON.parse(data.toString('utf8')));
      if (replies.length === count) resolve(replies);
    });
  });
}

test('acks frames in order over the socket and serves the stats (SPEC-VO-PLAY-STREAM-SOCKET)', async () => {
  const server = await startServer();
  try {
    const { ws } = await connect(server.port, { origin: ALLOWED_ORIGIN });
    const replies = collectReplies(ws, 5);
    ws.send(JSON.stringify(startFrame()));
    ws.send(JSON.stringify(trialFrame(1, { outcome: 'wrong' })));
    ws.send(JSON.stringify(trialFrame(2, { attempt: 2, since_wrong_ms: 400 })));
    ws.send(JSON.stringify(endFrame(3)));
    ws.send(JSON.stringify({ type: 'event', sessionId: SESSION_ID, seq: 4 }));
    const received = await replies;
    assert.deepEqual(received.slice(0, 4).map((reply) => [reply.type, reply.seq]), [['ack', 0], ['ack', 1], ['ack', 2], ['ack', 3]]);
    assert.equal(received[4].code, 'invalid_frame');
    ws.close();

    const response = await fetch(`http://127.0.0.1:${server.port}/api/v1/play-stream/stats?game_id=uni-math`, { headers: { origin: ALLOWED_ORIGIN } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), ALLOWED_ORIGIN);
    const body = await response.json();
    assert.equal(body.data.games[0].game_id, 'uni-math');
    assert.equal(body.data.games[0].first_try_accuracy, 0);
    assert.equal(body.data.recent[0].session_id, SESSION_ID);

    const foreign = await fetch(`http://127.0.0.1:${server.port}/api/v1/play-stream/stats`, { headers: { origin: 'https://evil.example' } });
    assert.equal(foreign.status, 403);
    const badGame = await fetch(`http://127.0.0.1:${server.port}/api/v1/play-stream/stats?game_id=bad%20id`);
    assert.equal(badGame.status, 400);
  } finally {
    await server.close();
  }
});

test('refuses foreign origins, other paths and connections over the cap', async () => {
  const server = await startServer({ maxConnections: 1 });
  try {
    assert.equal((await connect(server.port, { origin: 'https://evil.example' })).status, 403);
    assert.equal((await connect(server.port, { path: '/api/v1/other' })).status, 0);
    const first = await connect(server.port);
    assert.ok(first.ws);
    assert.equal((await connect(server.port)).status, 503);
    first.ws.close();
  } finally {
    await server.close();
  }
});
