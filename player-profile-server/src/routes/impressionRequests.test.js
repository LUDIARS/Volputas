const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createImpressionRequestsRouter } = require('./impressionRequests');
const { createImpressionRequestAuth } = require('../middleware/impressionRequestAuth');
const { errorHandler } = require('../middleware/errorHandler');

test('request scope is required; export read token cannot create a request', async () => {
  const middleware = createImpressionRequestAuth({ verifier: { verify: async () => ({ sub: 'discutere', scope: ['persona-export:read'] }) } });
  let error;
  await middleware({ headers: { authorization: 'Bearer v4.public.fixture' } }, {}, e => { error = e; });
  assert.equal(error.statusCode, 403);
});

test('acceptance is idempotent, scoped, and does not claim collection completion', async t => {
  const stored = new Map();
  const key = (owner, id) => `${owner}/${id}`;
  const repository = {
    find: async (owner, id) => stored.get(key(owner, id)) || null,
    list: async owner => [...stored].filter(([k]) => k.startsWith(`${owner}/`)).map(([, v]) => v),
    accept: async (owner, id, theme) => {
      const k = key(owner, id); const created = !stored.has(k);
      if (created) stored.set(k, { requestId: id, theme, status: 'accepted', acceptedAt: '2026-10-08T00:00:00Z' });
      return { created, request: stored.get(k) };
    },
  };
  const app = express(); app.use(express.json());
  app.use('/requests', createImpressionRequestsRouter({ repository, authenticateMiddleware: (req, _res, next) => { req.impressionRequester = req.headers['x-test-owner'] || 'di'; next(); } }));
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/requests`;
  const send = theme => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: 'di:one', theme }) });
  const first = await send('ゲームの操作感');
  assert.equal(first.status, 201);
  assert.equal((await first.json()).data.request.status, 'accepted');
  assert.equal((await send('ゲームの操作感')).status, 200);
  assert.equal((await send('別のテーマ')).status, 409);
  assert.equal(stored.size, 1);
  assert.equal((await fetch(`${url}/di:one`, { headers: { 'x-test-owner': 'other' } })).status, 404);
  const own = await fetch(`${url}/di:one`);
  assert.equal((await own.json()).data.request.theme, 'ゲームの操作感');
});
