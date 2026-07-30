const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createPersonaExportRouter, parseCursor } = require('./personaExport');

test('online persona export returns one JSON object per line and a paging cursor', async (t) => {
  const nextCursor = '22222222-2222-4222-8222-222222222222';
  const app = express();
  app.use('/api/personas', createPersonaExportRouter({
    authenticateMiddleware: (_req, _res, next) => next(),
    service: {
      async listPage(input) {
        assert.deepEqual(input, { cursor: null, limit: '1' });
        return {
          personas: [{
            pseudoId: 'ext:voluptas:0123456789abcdef',
            preferenceAxes: { 'style.explorer': 0.8 },
            aversions: [],
            traits: [],
            attributes: {},
            mechanicReactions: [],
            exportSpecVersion: 2,
          }],
          nextCursor,
        };
      },
    },
  }));
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/api/personas/export?limit=1`
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/x-ndjson/);
  assert.equal(response.headers.get('x-next-cursor'), nextCursor);
  const lines = (await response.text()).trim().split('\n');
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).exportSpecVersion, 2);
});

test('online persona export rejects malformed cursors', () => {
  assert.equal(parseCursor(undefined), null);
  assert.throws(() => parseCursor('not-a-user-id'), {
    code: 'INVALID_EXPORT_CURSOR',
  });
});

test('online population report uses project authentication and returns aggregate counts', async (t) => {
  let authenticated = false;
  let received;
  const app = express();
  app.use(express.json());
  app.use('/api/personas', createPersonaExportRouter({
    authenticateMiddleware: (_req, _res, next) => {
      authenticated = true;
      next();
    },
    service: { async listPage() { return { personas: [], nextCursor: null }; } },
    populationService: {
      async import(report) {
        received = report;
        return { received: 1, matched: 1, updated: 1 };
      },
    },
  }));
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));

  const report = {
    generatedAt: '2026-07-28T00:00:00.000Z',
    realPopulation: 10,
    entries: [],
  };
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/api/personas/population-report`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
    }
  );
  assert.equal(response.status, 200);
  assert.equal(authenticated, true);
  assert.deepEqual(received, report);
  assert.deepEqual((await response.json()).data, {
    received: 1,
    matched: 1,
    updated: 1,
  });
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
});
