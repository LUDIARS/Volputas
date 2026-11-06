const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');
const { createGlabGameRouter } = require('./glabGames');
const { createGlabSurveyRouter } = require('./glabSurveys');
const { createGlabReviewRouter } = require('./glabReviews');
const { fixtureDelegation, scopedFetch } = require('./glabScoped.fixture');
const { AppError, errorHandler } = require('../middleware/errorHandler');
const pass = (_req, _res, next) => next();

async function withRouter(router, exercise) {
  const app = express(); app.use('/catalog', router); app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  try { await exercise(`http://127.0.0.1:${server.address().port}/catalog`); }
  finally { server.closeAllConnections(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
function options(user = { id: 'subject', role: 'general' }) {
  return { delegation: fixtureDelegation(user), transportRateLimiter: pass, userRateLimiter: pass };
}

test('game administration uses the live authority role, ignoring submitted role/actor', async () => {
  const actor = { id: 'subject', role: 'general' }; let created;
  const router = createGlabGameRouter({ ...options(actor), service: {
    registerGame: async (owner, body) => { created = { owner, body }; return { id: 'game' }; },
  } });
  await withRouter(router, async base => {
    const body = JSON.stringify({ title: 'Game', role: 'admin', ownerId: 'attacker' });
    const denied = await scopedFetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    assert.equal(denied.status, 403); assert.equal(created, undefined);
    actor.role = 'admin';
    const allowed = await scopedFetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    assert.equal(allowed.status, 201); assert.equal(created.owner, 'subject');
    assert.equal(created.body.ownerId, 'attacker'); // Service schemas reject it; it never becomes identity.
  });
});

test('survey reads/responses recheck current publication before endpoint execution', async () => {
  let visible = true, executed = 0;
  const router = createGlabSurveyRouter({ ...options(), service: {
    authorizeSurvey: async () => { if (!visible) throw new AppError(404, 'NOT_FOUND', 'Survey not found'); return true; },
    getSurvey: async owner => { assert.equal(owner, 'subject'); executed++; return { survey: {} }; },
    saveResponse: async owner => { assert.equal(owner, 'subject'); executed++; return {}; },
  } });
  await withRouter(router, async base => {
    assert.equal((await scopedFetch(`${base}/survey`)).status, 200);
    visible = false;
    assert.equal((await scopedFetch(`${base}/survey`)).status, 404);
    assert.equal((await scopedFetch(`${base}/survey/response`, { method: 'PUT',
      headers: { 'content-type': 'application/json' }, body: '{"answers":[]}' })).status, 404);
  });
  assert.equal(executed, 1);
});

test('old Bearer and unknown operations cannot fall back', async () => {
  let executed = 0;
  const router = createGlabGameRouter({ ...options(), service: { listGames: async () => { executed++; return []; } } });
  await withRouter(router, async base => {
    assert.equal((await fetch(base, { headers: { authorization: 'Bearer old-global-or-project-token' } })).status, 401);
    assert.equal((await scopedFetch(`${base}/unknown-private-data`)).status, 403);
    assert.equal((await scopedFetch(base, { method: 'DELETE' })).status, 403);
    assert.equal((await scopedFetch(base, { method: 'HEAD' })).status, 403);
    assert.equal((await scopedFetch(base)).status, 200);
  });
  assert.equal(executed, 1);
});

test('a specific analysis catalog route consumes one proof without falling into the record-id gate', async () => {
  let consumed = 0;
  const delegation = fixtureDelegation({ id: 'subject' }, async (_action, operation) => {
    consumed++;
    assert.equal(operation.action, 'review.analysis.catalog');
    return { allowed: true, projectKey: 'voluptas', sourceProject: 'glab',
      user: { id: 'subject', displayName: 'Fixture', email: null, role: 'general' },
      requestId: operation.requestId, risk: 'read', expiresAt: new Date(Date.now() + 4_000).toISOString() };
  });
  const router = createGlabReviewRouter({ ...options(), delegation,
    serviceProvider: () => ({ loadVoice: async () => assert.fail('Catalog is not a private voice record') }),
    analysisService: { status: () => assert.fail('Catalog must not load an analysis') },
  });
  await withRouter(router, async base => {
    assert.equal((await scopedFetch(`${base}/analysis/catalog`)).status, 200);
  });
  assert.equal(consumed, 1);
});

test('raw JSON is parsed only after scoped authorization and keeps the existing JSON format boundary', async () => {
  let executed = 0;
  const router = createGlabGameRouter({ ...options({ id: 'subject', role: 'admin' }), service: {
    registerGame: async () => { executed++; return {}; },
  } });
  await withRouter(router, async base => {
    const invalid = await scopedFetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'not-json' });
    assert.equal(invalid.status, 400);
    const primitive = await scopedFetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'null' });
    assert.equal(primitive.status, 400);
    const wrongType = await scopedFetch(base, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
    assert.equal(wrongType.status, 415);
  });
  assert.equal(executed, 0);
});

test('review follow-up/analysis gate rechecks current owner and preserves explicit analysis consent', async () => {
  let owned = true, followed = 0;
  const router = createGlabReviewRouter({ ...options(), serviceProvider: () => ({
    loadVoice: async owner => { assert.equal(owner, 'subject'); if (!owned) throw new AppError(404, 'PROFILE_RECORD_NOT_FOUND', 'Voice not found'); return { id: 'voice' }; },
    followUp: async () => { followed++; return {}; },
  }), analysisService: { status: () => ({}) } });
  await withRouter(router, async base => {
    assert.equal((await scopedFetch(`${base}/voice/follow-up`)).status, 200);
    owned = false;
    assert.equal((await scopedFetch(`${base}/voice/follow-up`)).status, 404);
    owned = true;
    assert.equal((await scopedFetch(`${base}/analysis/voice`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 400);
  });
  assert.equal(followed, 1);
});
