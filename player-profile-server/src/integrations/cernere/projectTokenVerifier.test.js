const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const { V4 } = require('paseto');
const {
  InvalidCernereTokenError,
} = require('./cernereErrors');
const {
  CernereProjectTokenVerifier,
} = require('./projectTokenVerifier');

function rawPublicKey(publicKey) {
  const der = publicKey.export({ format: 'der', type: 'spki' });
  return der.subarray(der.length - 32);
}

async function signedToken(privateKey, overrides = {}) {
  const now = Date.now();
  return V4.sign({
    sub: '66e242b5-2f18-4463-b7f0-c0f12d818a20',
    projectKey: 'volputas',
    kind: 'user_for_project',
    role: 'general',
    displayName: 'Test User',
    aud: 'http://volputas.test',
    iat: new Date(now).toISOString(),
    exp: new Date(now + 60_000).toISOString(),
    jti: 'test-jti',
    ...overrides,
  }, privateKey, { kid: 'test-key' });
}

function providerFor(key) {
  return {
    hasUsableCache: () => false,
    getKeys: async () => [{ kid: 'test-key', key }],
  };
}

test('verifies a real Cernere user-for-Volputas PASETO', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const verifier = new CernereProjectTokenVerifier({
    audience: 'http://volputas.test',
    keyProvider: providerFor(rawPublicKey(publicKey)),
  });

  const claims = await verifier.verify(await signedToken(privateKey));
  assert.equal(claims.sub, '66e242b5-2f18-4463-b7f0-c0f12d818a20');
  assert.equal(claims.projectKey, 'volputas');
});

test('rejects a token for another audience or project', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const verifier = new CernereProjectTokenVerifier({
    audience: 'http://volputas.test',
    keyProvider: providerFor(rawPublicKey(publicKey)),
  });

  await assert.rejects(
    verifier.verify(await signedToken(privateKey, { aud: 'http://other.test' })),
    InvalidCernereTokenError,
  );
  await assert.rejects(
    verifier.verify(await signedToken(privateKey, { projectKey: 'other' })),
    InvalidCernereTokenError,
  );
  await assert.rejects(
    verifier.verify(await signedToken(privateKey, { kind: 'project' })),
    InvalidCernereTokenError,
  );
});

test('does not accept a non-PASETO bearer value', async () => {
  const verifier = new CernereProjectTokenVerifier({
    audience: 'http://volputas.test',
    keyProvider: providerFor(Buffer.alloc(32)),
  });
  await assert.rejects(verifier.verify('jwt-like-value'), InvalidCernereTokenError);
});

test('rejects expired and incorrectly signed PASETO values', async () => {
  const current = generateKeyPairSync('ed25519');
  const other = generateKeyPairSync('ed25519');
  const verifier = new CernereProjectTokenVerifier({
    audience: 'http://volputas.test',
    keyProvider: providerFor(rawPublicKey(current.publicKey)),
  });
  const past = Date.now() - 60_000;

  await assert.rejects(
    verifier.verify(await signedToken(current.privateKey, {
      iat: new Date(past - 60_000).toISOString(),
      exp: new Date(past).toISOString(),
    })),
    InvalidCernereTokenError,
  );
  await assert.rejects(
    verifier.verify(await signedToken(other.privateKey)),
    InvalidCernereTokenError,
  );
});

test('refreshes a cached key set once after signature verification fails', async () => {
  const previous = generateKeyPairSync('ed25519');
  const current = generateKeyPairSync('ed25519');
  const calls = [];
  const verifier = new CernereProjectTokenVerifier({
    audience: 'http://volputas.test',
    keyProvider: {
      hasUsableCache: () => true,
      async getKeys(options = {}) {
        calls.push(options);
        return [{
          kid: options.forceRefresh ? 'current' : 'previous',
          key: rawPublicKey(
            options.forceRefresh ? current.publicKey : previous.publicKey,
          ),
        }];
      },
    },
  });

  const claims = await verifier.verify(await signedToken(current.privateKey));
  assert.equal(claims.projectKey, 'volputas');
  assert.deepEqual(calls, [{}, { forceRefresh: true }]);
});

test('does not refresh cached keys for valid signatures with rejected claims', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const calls = [];
  const verifier = new CernereProjectTokenVerifier({
    audience: 'http://volputas.test',
    keyProvider: {
      hasUsableCache: () => true,
      async getKeys(options = {}) {
        calls.push(options);
        return [{ kid: 'current', key: rawPublicKey(publicKey) }];
      },
    },
  });
  const past = Date.now() - 60_000;

  for (const token of [
    await signedToken(privateKey, { aud: 'http://other.test' }),
    await signedToken(privateKey, { projectKey: 'other' }),
    await signedToken(privateKey, { kind: 'project' }),
    await signedToken(privateKey, {
      iat: new Date(past - 60_000).toISOString(),
      exp: new Date(past).toISOString(),
    }),
  ]) {
    await assert.rejects(verifier.verify(token), InvalidCernereTokenError);
  }

  assert.equal(calls.length, 4);
  assert.equal(calls.some((options) => options.forceRefresh), false);
});

test('rate-limits forced refreshes for repeated signature failures', async () => {
  const current = generateKeyPairSync('ed25519');
  const untrusted = generateKeyPairSync('ed25519');
  const calls = [];
  let now = 1_000;
  const verifier = new CernereProjectTokenVerifier({
    audience: 'http://volputas.test',
    now: () => now,
    refreshCooldownMs: 100,
    keyProvider: {
      hasUsableCache: () => true,
      async getKeys(options = {}) {
        calls.push(options);
        return [{ kid: 'current', key: rawPublicKey(current.publicKey) }];
      },
    },
  });
  const token = await signedToken(untrusted.privateKey);

  await assert.rejects(verifier.verify(token), InvalidCernereTokenError);
  await assert.rejects(verifier.verify(token), InvalidCernereTokenError);
  assert.equal(calls.filter((options) => options.forceRefresh).length, 1);

  now += 100;
  await assert.rejects(verifier.verify(token), InvalidCernereTokenError);
  assert.equal(calls.filter((options) => options.forceRefresh).length, 2);
});
