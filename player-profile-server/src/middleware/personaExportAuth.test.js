const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const { V4 } = require('paseto');
const {
  CernereProjectTokenVerifier,
  serviceClaimsSchema,
} = require('../integrations/cernere/projectTokenVerifier');
const {
  HASTER_PUBLIC_TEST_PERSONA_EXPORT_TOKEN,
} = require('../haster/publicTestIdentity');
const {
  bearerToken,
  createPersonaExportAuth,
  tokensMatch,
} = require('./personaExportAuth');

test('persona export project credential comparison is exact and timing-safe compatible', () => {
  assert.equal(bearerToken('Bearer project-secret'), 'project-secret');
  assert.equal(bearerToken('bearer project-secret'), null);
  assert.equal(tokensMatch('project-secret', 'project-secret'), true);
  assert.equal(tokensMatch('wrong-secret', 'project-secret'), false);
  assert.equal(tokensMatch('short', 'project-secret'), false);
});

test('persona export authentication fails closed when unconfigured', () => {
  const middleware = createPersonaExportAuth({ expectedToken: '' });
  let forwarded;
  middleware({ headers: {} }, {}, (error) => {
    forwarded = error;
  });
  assert.equal(forwarded.code, 'PERSONA_EXPORT_UNAVAILABLE');
  assert.equal(forwarded.statusCode, 503);
});

test('persona export authentication rejects an invalid credential without forwarding it', () => {
  const middleware = createPersonaExportAuth({ expectedToken: 'project-secret' });
  let response;
  middleware(
    { headers: { authorization: 'Bearer must-not-leak' } },
    {
      status(statusCode) {
        response = { statusCode };
        return this;
      },
      json(body) {
        response.body = body;
      },
    },
    () => assert.fail('invalid credentials must not reach the route')
  );
  assert.equal(response.statusCode, 401);
  assert.doesNotMatch(JSON.stringify(response.body), /must-not-leak|project-secret/);
});

function rawPublicKey(publicKey) {
  const der = publicKey.export({ format: 'der', type: 'spki' });
  return der.subarray(der.length - 32);
}

function serviceSetup() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const verifier = new CernereProjectTokenVerifier({
    audience: 'volputas',
    claimsSchema: serviceClaimsSchema,
    keyProvider: {
      hasUsableCache: () => false,
      getKeys: async () => [{ kid: 'test-key', key: rawPublicKey(publicKey) }],
    },
  });
  const sign = (overrides = {}) => {
    const now = Date.now();
    return V4.sign({
      kind: 'service',
      sub: 'discutere',
      aud: 'volputas',
      scope: ['persona-export:read'],
      iat: new Date(now).toISOString(),
      exp: new Date(now + 60_000).toISOString(),
      jti: 'service-jti',
      ...overrides,
    }, privateKey, { kid: 'test-key' });
  };
  return { verifier, sign };
}

async function run(middleware, authorization) {
  const outcome = { next: false, error: null, statusCode: null, body: null };
  await middleware(
    { headers: authorization ? { authorization } : {} },
    {
      status(statusCode) {
        outcome.statusCode = statusCode;
        return this;
      },
      json(body) {
        outcome.body = body;
      },
    },
    (error) => {
      outcome.next = !error;
      outcome.error = error || null;
    }
  );
  return outcome;
}

test('persona export accepts a Cernere service token with the persona-export:read scope', async () => {
  const { verifier, sign } = serviceSetup();
  const middleware = createPersonaExportAuth({
    expectedToken: 'project-secret',
    serviceTokenVerifier: verifier,
  });
  const outcome = await run(middleware, `Bearer ${await sign()}`);
  assert.equal(outcome.next, true);
});

test('persona export service token works even when the legacy token is unset', async () => {
  const { verifier, sign } = serviceSetup();
  const middleware = createPersonaExportAuth({ expectedToken: '', serviceTokenVerifier: verifier });
  const outcome = await run(middleware, `Bearer ${await sign()}`);
  assert.equal(outcome.next, true);
});

test('persona export rejects a service token without the required scope with 403', async () => {
  const { verifier, sign } = serviceSetup();
  const middleware = createPersonaExportAuth({
    expectedToken: 'project-secret',
    serviceTokenVerifier: verifier,
  });
  const outcome = await run(middleware, `Bearer ${await sign({ scope: ['persona-bridge:write'] })}`);
  assert.equal(outcome.statusCode, 403);
  assert.equal(outcome.body.error.code, 'PERSONA_EXPORT_FORBIDDEN');
  assert.equal(outcome.next, false);
});

test('persona export rejects invalid service tokens with 401 regardless of caller name', async () => {
  const { verifier, sign } = serviceSetup();
  const middleware = createPersonaExportAuth({
    expectedToken: 'project-secret',
    serviceTokenVerifier: verifier,
  });
  const invalid = [
    await sign({ aud: 'discutere' }),
    await sign({ kind: 'user_for_project' }),
    await sign({ exp: new Date(Date.now() - 1_000).toISOString() }),
    'v4.public.tampered',
  ];
  for (const token of invalid) {
    const outcome = await run(middleware, `Bearer ${token}`);
    assert.equal(outcome.statusCode, 401);
    assert.equal(outcome.next, false);
  }
  const otherCaller = await run(middleware, `Bearer ${await sign({ sub: 'any-other-service' })}`);
  assert.equal(otherCaller.next, true);
});

test('persona export keeps accepting the legacy fixed token and the HASTER fixture during P4', async () => {
  const legacy = await run(
    createPersonaExportAuth({ expectedToken: 'project-secret', serviceTokenVerifier: { verify: () => assert.fail() } }),
    'Bearer project-secret'
  );
  assert.equal(legacy.next, true);

  const haster = await run(
    createPersonaExportAuth({ expectedToken: HASTER_PUBLIC_TEST_PERSONA_EXPORT_TOKEN }),
    `Bearer ${HASTER_PUBLIC_TEST_PERSONA_EXPORT_TOKEN}`
  );
  assert.equal(haster.next, true);

  const missing = await run(createPersonaExportAuth({ expectedToken: 'project-secret' }), null);
  assert.equal(missing.statusCode, 401);
});
