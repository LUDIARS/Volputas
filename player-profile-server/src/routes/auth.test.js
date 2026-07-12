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
