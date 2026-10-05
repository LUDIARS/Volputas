const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CernereServiceTokenClient,
  ServiceTokenIssueError,
} = require('./serviceTokenClient');

function issuedResponse(token = 'v4.public.mock-issued', expiresIn = 900) {
  return Response.json({
    tokenType: 'service',
    accessToken: token,
    expiresIn,
    subject: 'volputas',
    audience: 'discutere',
    scope: ['persona-bridge:write'],
    alg: 'EdDSA',
  });
}

function clientWith(fetchImpl, overrides = {}) {
  return new CernereServiceTokenClient({
    baseUrl: 'https://cernere.test/',
    clientId: 'volputas-client',
    clientSecret: 'volputas-secret',
    targetProjectKey: 'discutere',
    fetchImpl,
    ...overrides,
  });
}

test('issues a service token from Cernere with client credentials and the target project key', async () => {
  let requested;
  const client = clientWith(async (url, options) => {
    requested = { url: String(url), options, body: JSON.parse(options.body) };
    return issuedResponse();
  });

  assert.equal(await client.getToken(), 'v4.public.mock-issued');
  assert.equal(requested.url, 'https://cernere.test/api/auth/service-token');
  assert.equal(requested.options.method, 'POST');
  assert.equal(requested.options.redirect, 'error');
  assert.deepEqual(requested.body, {
    client_id: 'volputas-client',
    client_secret: 'volputas-secret',
    target_project_key: 'discutere',
  });
});

test('caches the token in memory until 60 seconds before expiry', async () => {
  let now = 1_000_000;
  let calls = 0;
  const client = clientWith(async () => {
    calls += 1;
    return issuedResponse(`v4.public.token-${calls}`, 900);
  }, { now: () => now });

  assert.equal(await client.getToken(), 'v4.public.token-1');
  now += (900 - 61) * 1000;
  assert.equal(await client.getToken(), 'v4.public.token-1');
  now += 1000;
  assert.equal(await client.getToken(), 'v4.public.token-2');
  assert.equal(calls, 2);
});

test('shares one in-flight issuance between concurrent callers', async () => {
  let calls = 0;
  const client = clientWith(async () => {
    calls += 1;
    return issuedResponse();
  });
  const tokens = await Promise.all([client.getToken(), client.getToken(), client.getToken()]);
  assert.deepEqual(tokens, ['v4.public.mock-issued', 'v4.public.mock-issued', 'v4.public.mock-issued']);
  assert.equal(calls, 1);
});

test('reports a reason code for each issuance failure without calling Cernere when unconfigured', async () => {
  const unconfigured = clientWith(async () => assert.fail('must not call Cernere'), { clientSecret: '' });
  await assert.rejects(unconfigured.getToken(), { name: 'ServiceTokenIssueError', reason: 'not_configured' });

  for (const [status, reason] of [
    [401, 'unauthorized'],
    [403, 'scope_undeclared'],
    [404, 'target_not_found'],
    [503, 'http_503'],
  ]) {
    const client = clientWith(async () => new Response('{}', { status }));
    await assert.rejects(client.getToken(), (error) => {
      assert.ok(error instanceof ServiceTokenIssueError);
      assert.equal(error.reason, reason);
      assert.doesNotMatch(error.message, /volputas-secret/);
      return true;
    });
  }

  const offline = clientWith(async () => {
    throw new TypeError('fetch failed');
  });
  await assert.rejects(offline.getToken(), { reason: 'network' });

  const malformed = clientWith(async () => Response.json({ accessToken: 'not-a-paseto', expiresIn: 900 }));
  await assert.rejects(malformed.getToken(), { reason: 'invalid_response' });
});
