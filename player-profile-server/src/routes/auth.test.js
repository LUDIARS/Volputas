const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { MemoryOneTimeStore } = require('../services/oneTimeStore');
const { createAuthRouter } = require('./auth');

function createSource() {
  return {
    key: 'google',
    kind: 'oidc',
    buildAuthorizationUrl(state) {
      return `https://idp.example/authorize?state=${state}`;
    },
    async resolveIdentity() {
      return {
        provider: 'google',
        providerSub: 'subject-1',
        profile: { displayName: 'Player' },
        rawProfile: { sub: 'subject-1' },
      };
    },
  };
}

test('browser login uses one-shot state and one-shot ticket', async (t) => {
  const app = express();
  app.use(express.json());
  const store = new MemoryOneTimeStore();
  app.use('/auth', createAuthRouter({
    oneTimeStore: store,
    resolveSource: (provider) => provider === 'google' ? createSource() : null,
    findOrCreateUser: async () => 'user-1',
    issue: async () => ({ accessToken: 'access', refreshToken: 'refresh' }),
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const invalid = await fetch(`${base}/auth/login?provider=steam`);
  assert.equal(invalid.status, 400);

  const login = await fetch(`${base}/auth/login?provider=google`).then((response) => response.json());
  const state = new URL(login.data.authorizationUrl).searchParams.get('state');
  const callback = await fetch(`${base}/auth/callback?code=code&state=${state}`, { redirect: 'manual' });
  assert.equal(callback.status, 302);
  const ticket = new URL(callback.headers.get('location')).hash.slice('#ticket='.length);

  const replayedState = await fetch(`${base}/auth/callback?code=code&state=${state}`, { redirect: 'manual' });
  assert.equal(replayedState.status, 400);

  const exchange = await fetch(`${base}/auth/ticket`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ticket }),
  });
  assert.equal(exchange.status, 200);
  assert.equal((await exchange.json()).data.access_token, 'access');

  const replayedTicket = await fetch(`${base}/auth/ticket`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ticket }),
  });
  assert.equal(replayedTicket.status, 401);
});

test('Spectator login returns a PKCE-protected ticket only to a numeric loopback address', async (t) => {
  const app = express();
  app.use(express.json());
  const store = new MemoryOneTimeStore();
  app.use('/auth', createAuthRouter({
    oneTimeStore: store,
    resolveSource: (provider) => provider === 'google' ? createSource() : null,
    findOrCreateUser: async () => 'user-1',
    issue: async () => ({ accessToken: 'access', refreshToken: 'refresh' }),
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const verifier = 'spectator-verifier-012345678901234567890123456789';
  const challenge = require('node:crypto').createHash('sha256').update(verifier).digest('base64url');
  const params = new URLSearchParams({
    provider: 'google',
    client: 'spectator',
    redirect_uri: 'http://127.0.0.1:49152/callback',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    nonce: 'spectator-nonce-1234567890',
  });
  const login = await fetch(`${base}/auth/login?${params}`).then((response) => response.json());
  const oauthState = new URL(login.data.authorizationUrl).searchParams.get('state');
  const callback = await fetch(`${base}/auth/callback?code=code&state=${oauthState}`, { redirect: 'manual' });
  const redirect = new URL(callback.headers.get('location'));
  assert.equal(redirect.origin, 'http://127.0.0.1:49152');
  assert.equal(redirect.pathname, '/callback');
  assert.equal(redirect.searchParams.get('state'), 'spectator-nonce-1234567890');
  const ticket = redirect.searchParams.get('ticket');

  const invalidVerifier = await fetch(`${base}/auth/ticket`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ticket, code_verifier: `${verifier}x` }),
  });
  assert.equal(invalidVerifier.status, 401);
  const consumedTicket = await fetch(`${base}/auth/ticket`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ticket, code_verifier: verifier }),
  });
  assert.equal(consumedTicket.status, 401);

  params.set('redirect_uri', 'http://localhost:49152/callback');
  const invalidRedirect = await fetch(`${base}/auth/login?${params}`);
  assert.equal(invalidRedirect.status, 400);
});
