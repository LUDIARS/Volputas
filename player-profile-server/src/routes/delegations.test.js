const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { errorHandler } = require('../middleware/errorHandler');
const { createDelegationRouter } = require('./delegations');

const USER = '11111111-1111-4111-8111-111111111111';
const GRANT = '22222222-2222-4222-8222-222222222222';
const CLAIM = '33333333-3333-4333-8333-333333333333';

test('delegation REST boundary authenticates actors and keeps invite token one-time response data', async (t) => {
  const calls = [];
  const service = {
    async createGrant(userId, body) {
      calls.push({ method: 'create', userId, body });
      return { grant: { id: GRANT, subject_user_id: userId }, inviteToken: 'token-once' };
    },
    async acceptInvite(userId, token) {
      calls.push({ method: 'accept', userId, token });
      return { id: GRANT, delegate_user_id: userId };
    },
    async previewInvite() { return { id: GRANT, purpose: '共同入力' }; },
    async listGrants(userId, direction) { return [{ userId, direction }]; },
    async revokeGrant() { return { id: GRANT, status: 'revoked' }; },
    async leaveGrant() { return { id: GRANT, status: 'revoked' }; },
    async proposeClaims(userId, grantId, claims) {
      calls.push({ method: 'propose', userId, grantId, claims });
      return [{ id: CLAIM }];
    },
    async listClaims() { return []; },
    async listAudit() { return []; },
    async decideClaim(userId, claimId, decision) {
      calls.push({ method: 'decide', userId, claimId, decision });
      return { id: claimId, status: 'accepted' };
    },
    async withdrawClaim() { return { id: CLAIM, status: 'withdrawn' }; },
  };
  const auth = (req, res, next) => {
    const userId = req.headers['x-test-user'];
    if (!userId) return res.status(401).json({ ok: false, error: { code: 'UNAUTHORIZED' } });
    req.user = { id: userId, issuedAt: 1_000 };
    next();
  };
  const app = express();
  app.use(express.json());
  app.use('/api/v1/delegations', createDelegationRouter({
    authenticateMiddleware: auth,
    recentAuthMiddleware: (_req, _res, next) => next(),
    service,
  }));
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/v1/delegations`;

  assert.equal((await fetch(base)).status, 401);
  const schema = await fetch(`${base}/schema`, { headers: { 'x-test-user': USER } });
  assert.equal(schema.status, 200);
  assert.equal((await schema.json()).data.free_text_allowed, false);
  const created = await fetch(base, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-user': USER },
    body: JSON.stringify({ allowed_fields: ['playstyle_tags'], purpose: '共同入力' }),
  });
  assert.equal(created.status, 201);
  assert.equal(created.headers.get('cache-control'), 'no-store');
  assert.equal((await created.json()).data.invite_token, 'token-once');

  const invalidGrant = await fetch(`${base}/not-a-uuid/claims`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-user': USER },
    body: JSON.stringify({ claims: [] }),
  });
  assert.equal(invalidGrant.status, 400);

  const decision = await fetch(`${base}/claims/${CLAIM}/decision`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-user': USER },
    body: JSON.stringify({ decision: 'accept' }),
  });
  assert.equal(decision.status, 200);
  assert.equal(calls.some((call) => call.method === 'decide' && call.userId === USER), true);
});
