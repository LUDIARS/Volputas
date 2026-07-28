const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CernereIntegrationError,
} = require('./cernereErrors');
const {
  CernerePublicKeyProvider,
  decodePublicKey,
} = require('./publicKeyProvider');

test('fetches and caches the Cernere Ed25519 key set', async () => {
  let calls = 0;
  let now = 100;
  let requestOptions;
  const encoded = Buffer.alloc(32, 7).toString('base64');
  const provider = new CernerePublicKeyProvider({
    baseUrl: 'https://cernere.test',
    now: () => now,
    cacheTtlMs: 1_000,
    fetchImpl: async (_url, options) => {
      calls += 1;
      requestOptions = options;
      return Response.json({
        keys: [{ kid: 'current', alg: 'EdDSA', public_key: encoded }],
      });
    },
  });

  const first = await provider.getKeys();
  const second = await provider.getKeys();
  assert.equal(calls, 1);
  assert.equal(requestOptions.redirect, 'error');
  assert.deepEqual(first, second);
  assert.equal(first[0].key.length, 32);

  now = 1_101;
  await provider.getKeys();
  assert.equal(calls, 2);
});

test('rejects malformed or empty public key documents', async () => {
  const provider = new CernerePublicKeyProvider({
    baseUrl: 'https://cernere.test',
    fetchImpl: async () => Response.json({ keys: [] }),
  });
  await assert.rejects(provider.getKeys(), CernereIntegrationError);
  assert.throws(() => decodePublicKey('not-base64'), /base64/);
  assert.throws(
    () => decodePublicKey(Buffer.alloc(31).toString('base64')),
    /Ed25519/,
  );
});
