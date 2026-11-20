const test = require('node:test');
const assert = require('node:assert/strict');
const { readPlayStreamConfig } = require('./playStreamConfig');
const { checkPlayStreamReach } = require('./playStreamReach');
const { createFixedUserResolver } = require('./playStreamIdentity');

test('stays closed without a fixed subject and under HASTER (SPEC-VO-PLAY-STREAM-IDENTITY)', () => {
  assert.equal(readPlayStreamConfig({}), null);
  assert.equal(readPlayStreamConfig({ VOLUPTAS_PLAY_STREAM_FIXED_CERNERE_SUBJECT: ' ' }), null);
  assert.equal(readPlayStreamConfig({ VOLUPTAS_PLAY_STREAM_FIXED_CERNERE_SUBJECT: '1' }, { hasterEnabled: true }), null);
});

test('reads the subject, origins and connection cap', () => {
  assert.deepEqual(readPlayStreamConfig({
    VOLUPTAS_PLAY_STREAM_FIXED_CERNERE_SUBJECT: '1',
    VOLUPTAS_PLAY_STREAM_ALLOWED_ORIGINS: 'http://localhost:5381, http://127.0.0.1:5381/ ,*',
    VOLUPTAS_PLAY_STREAM_WS_MAX: '4',
  }), {
    fixedCernereSubject: '1',
    allowedOrigins: ['http://localhost:5381', 'http://127.0.0.1:5381'],
    maxConnections: 4,
  });
});

test('throws on malformed values', () => {
  assert.throws(() => readPlayStreamConfig({ VOLUPTAS_PLAY_STREAM_FIXED_CERNERE_SUBJECT: '1; drop' }));
  assert.throws(() => readPlayStreamConfig({ VOLUPTAS_PLAY_STREAM_FIXED_CERNERE_SUBJECT: '1', VOLUPTAS_PLAY_STREAM_WS_MAX: '0' }));
  assert.throws(() => readPlayStreamConfig({ VOLUPTAS_PLAY_STREAM_FIXED_CERNERE_SUBJECT: '1', VOLUPTAS_PLAY_STREAM_ALLOWED_ORIGINS: 'nope' }));
});

test('reach: loopback only, allowed origins only, no relays (SPEC-VO-PLAY-STREAM-REACH)', () => {
  const config = { allowedOrigins: ['http://localhost:5381'] };
  assert.equal(checkPlayStreamReach({ remoteAddress: '127.0.0.1', headers: {} }, config), null);
  assert.equal(checkPlayStreamReach({ remoteAddress: '::ffff:127.0.0.1', headers: { origin: 'http://localhost:5381' } }, config), null);
  assert.equal(checkPlayStreamReach({ remoteAddress: '192.168.1.20', headers: {} }, config).code, 'NOT_LOOPBACK');
  assert.equal(checkPlayStreamReach({ remoteAddress: '127.0.0.1', headers: { origin: 'https://evil.example' } }, config).code, 'ORIGIN_NOT_ALLOWED');
  assert.equal(checkPlayStreamReach({ remoteAddress: '127.0.0.1', headers: { 'x-forwarded-for': '203.0.113.9' } }, config).code, 'RELAYED');
});

test('the fixed user is resolved once through the cernere federated identity', async () => {
  const calls = [];
  const resolve = createFixedUserResolver('1', {
    findOrCreate: async (provider, subject, profile) => {
      calls.push([provider, subject, profile.displayName]);
      if (calls.length === 1) throw new Error('db down');
      return 'user-uuid';
    },
  });
  await assert.rejects(resolve(), /db down/);
  assert.equal(await resolve(), 'user-uuid');
  assert.equal(await resolve(), 'user-uuid');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].slice(0, 2), ['cernere', '1']);
});
