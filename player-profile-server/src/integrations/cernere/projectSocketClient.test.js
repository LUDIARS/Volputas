const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  CernereProjectSocketClient,
  projectWebSocketUrl,
} = require('./projectSocketClient');

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.readyState = 0;
    this.sent = [];
  }

  send(value) {
    this.sent.push(JSON.parse(value));
  }

  close() {
    this.readyState = 3;
  }
}

test('Cernere project client authenticates and correlates module responses', async () => {
  const socket = new FakeSocket();
  let protocols;
  const client = new CernereProjectSocketClient({
    baseUrl: 'https://cernere.example.test/',
    clientId: 'volputas-client',
    clientSecret: 'secret',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ accessToken: 'project-token' }),
    }),
    createWebSocket: (url, selectedProtocols) => {
      assert.equal(url, 'wss://cernere.example.test/ws/project');
      protocols = selectedProtocols;
      queueMicrotask(() => {
        socket.readyState = 1;
        socket.emit('message', JSON.stringify({ type: 'connected' }));
      });
      return socket;
    },
    now: () => 100,
  });

  const responsePromise = client.request('managed_project', 'get_user_data', {
    userId: 'owner',
    columns: ['gameplay_records'],
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(protocols, ['bearer', 'project-token']);
  assert.equal(socket.sent[0].request_id, 'volputas-100-0');

  socket.emit('message', JSON.stringify({
    type: 'module_response',
    request_id: socket.sent[0].request_id,
    payload: { gameplay_records: [] },
  }));
  assert.deepEqual(await responsePromise, { gameplay_records: [] });
  client.close();
});

test('project WebSocket URL rejects no transport downgrade', () => {
  assert.equal(projectWebSocketUrl('http://localhost:3100'), 'ws://localhost:3100/ws/project');
  assert.equal(projectWebSocketUrl('https://id.example'), 'wss://id.example/ws/project');
});
