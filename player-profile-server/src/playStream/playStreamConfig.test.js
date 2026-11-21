const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, randomBytes } = require('node:crypto');
const { readPlayStreamConfig } = require('./playStreamConfig');
const { checkPlayStreamRelay } = require('./playStreamReach');
const { createCernereUserResolver } = require('./playStreamIdentity');

// 合言葉はテストのたびにその場で作る (固定の値をソースに置かない)。
const TOKEN = randomBytes(24).toString('hex');
const SUB = '0d3c5a2e-7b1f-4c8e-9a6d-2f4b8e1c7a90';

test('stays closed without a relay token and under HASTER (SPEC-VO-PLAY-STREAM-IDENTITY)', () => {
  assert.equal(readPlayStreamConfig({}), null);
  assert.equal(readPlayStreamConfig({ VOLUPTAS_PLAY_STREAM_RELAY_TOKEN: '' }), null);
  assert.equal(readPlayStreamConfig({ VOLUPTAS_PLAY_STREAM_RELAY_TOKEN: TOKEN }, { hasterEnabled: true }), null);
});

test('reads the relay token digest and the connection cap', () => {
  const config = readPlayStreamConfig({ VOLUPTAS_PLAY_STREAM_RELAY_TOKEN: TOKEN, VOLUPTAS_PLAY_STREAM_WS_MAX: '4' });
  assert.deepEqual(config.relayTokenDigest, createHash('sha256').update(TOKEN).digest());
  assert.equal(config.maxConnections, 4);
});

test('throws on a short token or a bad cap', () => {
  assert.throws(() => readPlayStreamConfig({ VOLUPTAS_PLAY_STREAM_RELAY_TOKEN: 'short' }));
  assert.throws(() => readPlayStreamConfig({ VOLUPTAS_PLAY_STREAM_RELAY_TOKEN: TOKEN, VOLUPTAS_PLAY_STREAM_WS_MAX: '0' }));
});

test('relay check: loopback, no browser origin, no forwarding, matching token and a Cernere sub (SPEC-VO-PLAY-STREAM-REACH)', () => {
  const config = readPlayStreamConfig({ VOLUPTAS_PLAY_STREAM_RELAY_TOKEN: TOKEN });
  const headers = { 'x-ludellus-play-relay-token': TOKEN, 'x-ludellus-cernere-sub': SUB };
  assert.deepEqual(checkPlayStreamRelay({ remoteAddress: '::ffff:127.0.0.1', headers }, config), { cernereSub: SUB });
  assert.equal(checkPlayStreamRelay({ remoteAddress: '192.168.1.20', headers }, config).code, 'NOT_LOOPBACK');
  assert.equal(checkPlayStreamRelay({ remoteAddress: '127.0.0.1', headers: { ...headers, origin: 'http://localhost:5381' } }, config).code, 'BROWSER_NOT_ALLOWED');
  assert.equal(checkPlayStreamRelay({ remoteAddress: '127.0.0.1', headers: { ...headers, 'x-forwarded-for': '203.0.113.9' } }, config).code, 'FORWARDED');
  assert.equal(checkPlayStreamRelay({ remoteAddress: '127.0.0.1', headers: { ...headers, 'x-ludellus-play-relay-token': `${TOKEN}x` } }, config).code, 'RELAY_TOKEN_MISMATCH');
  assert.equal(checkPlayStreamRelay({ remoteAddress: '127.0.0.1', headers: { 'x-ludellus-play-relay-token': TOKEN } }, config).status, 401);
  assert.equal(checkPlayStreamRelay({ remoteAddress: '127.0.0.1', headers: { ...headers, 'x-ludellus-cernere-sub': 'bad sub!' } }, config).status, 401);
});

test('each Cernere sub is resolved once through the cernere federated identity', async () => {
  const calls = [];
  const resolve = createCernereUserResolver({
    findOrCreate: async (provider, subject) => {
      calls.push([provider, subject]);
      if (calls.length === 1) throw new Error('db down');
      return `user-of-${subject}`;
    },
  });
  await assert.rejects(resolve(SUB), /db down/);
  assert.equal(await resolve(SUB), `user-of-${SUB}`);
  assert.equal(await resolve(SUB), `user-of-${SUB}`);
  assert.equal(await resolve('other-sub'), 'user-of-other-sub');
  assert.deepEqual(calls, [['cernere', SUB], ['cernere', SUB], ['cernere', 'other-sub']]);
});
