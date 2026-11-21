const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { randomBytes } = require('node:crypto');
const express = require('express');
const { WebSocket } = require('ws');
const { createPlayStreamSocket, PLAY_STREAM_SOCKET_PATH } = require('./playStreamSocket');
const { createPlayStreamRecorder } = require('./playStreamRecorder');
const { createPlayStreamRouter } = require('./playStreamRoutes');
const { readPlayStreamConfig } = require('./playStreamConfig');
const { createMemoryPlayStreamStore } = require('./memoryPlayStreamStore.testHelper');
const { SESSION_ID, startFrame, trialFrame, endFrame } = require('./playStreamFrames.testHelper');

// 合言葉はテストのたびにその場で作る (固定の値をソースに置かない)。
const TOKEN = randomBytes(24).toString('hex');
const WRONG_TOKEN = randomBytes(24).toString('hex');
const ALICE = '0d3c5a2e-7b1f-4c8e-9a6d-2f4b8e1c7a90';
const BOB = '5e1a9c3d-2b4f-4e6a-8c0d-7f9b1a3e5c27';
const RELAY = (sub) => ({ 'x-ludellus-play-relay-token': TOKEN, 'x-ludellus-cernere-sub': sub });

async function startServer({ maxConnections = 4 } = {}) {
  const store = createMemoryPlayStreamStore();
  const config = { ...readPlayStreamConfig({ VOLUPTAS_PLAY_STREAM_RELAY_TOKEN: TOKEN }), maxConnections };
  // Voluptas の users.id の代わりに、Cernere の sub から決まる値を返す。
  const resolveUserId = async (sub) => `user-${sub}`;
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
function connect(port, { path = PLAY_STREAM_SOCKET_PATH, headers = {}, origin } = {}) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers, ...(origin ? { origin } : {}) });
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

test('records frames for the Cernere sub the relay passes and serves that person\'s stats (SPEC-VO-PLAY-STREAM-SOCKET)', async () => {
  const server = await startServer();
  try {
    const { ws } = await connect(server.port, { headers: RELAY(ALICE) });
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
    assert.equal((await server.store.findSession(SESSION_ID)).user_id, `user-${ALICE}`);

    const mine = await fetch(`http://127.0.0.1:${server.port}/api/v1/play-stream/stats?game_id=uni-math`, { headers: RELAY(ALICE) });
    assert.equal(mine.status, 200);
    const body = await mine.json();
    assert.equal(body.data.games[0].game_id, 'uni-math');
    assert.equal(body.data.recent[0].session_id, SESSION_ID);

    const theirs = await fetch(`http://127.0.0.1:${server.port}/api/v1/play-stream/stats`, { headers: RELAY(BOB) });
    assert.deepEqual((await theirs.json()).data, { games: [], recent: [] });

    const noToken = await fetch(`http://127.0.0.1:${server.port}/api/v1/play-stream/stats`, { headers: { 'x-ludellus-cernere-sub': ALICE } });
    assert.equal(noToken.status, 403);
    const noSub = await fetch(`http://127.0.0.1:${server.port}/api/v1/play-stream/stats`, { headers: { 'x-ludellus-play-relay-token': TOKEN } });
    assert.equal(noSub.status, 401);
  } finally {
    await server.close();
  }
});

test('another person cannot write into a session they did not start', async () => {
  const server = await startServer();
  try {
    const alice = await connect(server.port, { headers: RELAY(ALICE) });
    const aliceReplies = collectReplies(alice.ws, 1);
    alice.ws.send(JSON.stringify(startFrame()));
    await aliceReplies;
    const bob = await connect(server.port, { headers: RELAY(BOB) });
    const bobReplies = collectReplies(bob.ws, 1);
    bob.ws.send(JSON.stringify(trialFrame(1)));
    assert.equal((await bobReplies)[0].code, 'forbidden');
    alice.ws.close();
    bob.ws.close();
  } finally {
    await server.close();
  }
});

test('refuses browsers, missing or wrong tokens, other paths and connections over the cap', async () => {
  const server = await startServer({ maxConnections: 1 });
  try {
    assert.equal((await connect(server.port, { headers: RELAY(ALICE), origin: 'http://localhost:5381' })).status, 403);
    assert.equal((await connect(server.port)).status, 403);
    assert.equal((await connect(server.port, { headers: { ...RELAY(ALICE), 'x-ludellus-play-relay-token': WRONG_TOKEN } })).status, 403);
    assert.equal((await connect(server.port, { headers: { 'x-ludellus-play-relay-token': TOKEN } })).status, 401);
    assert.equal((await connect(server.port, { path: '/api/v1/other', headers: RELAY(ALICE) })).status, 0);
    const first = await connect(server.port, { headers: RELAY(ALICE) });
    assert.ok(first.ws);
    assert.equal((await connect(server.port, { headers: RELAY(BOB) })).status, 503);
    first.ws.close();
  } finally {
    await server.close();
  }
});
