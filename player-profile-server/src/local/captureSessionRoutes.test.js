const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { errorHandler } = require('../middleware/errorHandler');
const { createCaptureSessionRoutes } = require('./captureSessionRoutes');

async function startedRouter(t) {
  let stopCalls = 0;
  const captureSessionService = {
    async initialize() {},
    async stop() {
      stopCalls += 1;
      return { status: 'completed' };
    },
  };
  const app = express();
  app.use(express.json());
  app.use('/api/local/capture-sessions', createCaptureSessionRoutes({
    captureSessionService,
    configuredContext: async () => ({
      config: { name: 'tester' },
      gitAuthor: { repositoryRoot: '/repo' },
    }),
    companionInfo: () => ({ enabled: false }),
  }));
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    stopCalls: () => stopCalls,
  };
}

test('local capture mutations reject form-compatible content types', async (t) => {
  const { origin, stopCalls } = await startedRouter(t);
  const formResponse = await fetch(`${origin}/api/local/capture-sessions/active/stop`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: '{}',
  });
  assert.equal(formResponse.status, 415);
  assert.equal((await formResponse.json()).error.code, 'JSON_CONTENT_TYPE_REQUIRED');
  assert.equal(stopCalls(), 0);

  const jsonResponse = await fetch(`${origin}/api/local/capture-sessions/active/stop`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(jsonResponse.status, 200);
  assert.equal(stopCalls(), 1);
});
