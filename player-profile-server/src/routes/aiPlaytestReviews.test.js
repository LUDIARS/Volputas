const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createAiPlaytestReviewRouter } = require('./aiPlaytestReviews');
const { createAiPlaytestAuth } = require('../middleware/aiPlaytestAuth');
const { createAiPlaytestReviewService } = require('../services/aiPlaytest/aiPlaytestReviewService');
const { errorHandler } = require('../middleware/errorHandler');

const REVIEW = {
  format: 'ai-playtest-review/1',
  source: 'ai-autoplayer',
  game_id: 'bestia',
  game_title: 'Bestia',
  run_id: 'playtest:bestia-novice-s1-20261015T000000Z',
  persona: 'novice',
  engine_version: '0.2.0',
  adapter: 'sim:bestia',
  screen: 'image',
  ticks: 40,
  turns: 3,
  outcome: 'success',
  summary: '総評',
  good: [{ aspect: 'game', text: '良い', evidence: { ticks: [0], shots: [1] } }],
  bad: [{ aspect: 'control', text: '悪い', evidence: { ticks: [0], shots: [1] } }],
  confusions: [],
  reflection: ['反省'],
  created_at: '2026-10-15T00:00:00.000Z',
};

function serve(expectedToken, verifier = null) {
  const saved = [];
  const store = {
    async save(record) {
      const existing = saved.find((item) => item.runId === record.runId);
      if (existing) return { record: existing, created: false };
      saved.push(record);
      return { record, created: true };
    },
    async list({ limit }) {
      return saved.slice(0, limit);
    },
  };
  const service = createAiPlaytestReviewService({ store });
  const app = express();
  app.use(express.json());
  app.use('/api/ai-playtests/reviews', createAiPlaytestReviewRouter({
    serviceProvider: () => service,
    writeAuth: createAiPlaytestAuth({ expectedToken, serviceTokenVerifier: verifier }),
  }));
  app.use(errorHandler);
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ server, saved, url: `http://127.0.0.1:${server.address().port}/api/ai-playtests/reviews` }));
  });
}

function post(url, token, body = REVIEW, key = REVIEW.run_id) {
  return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'idempotency-key': key }, body: JSON.stringify(body) });
}

test('POST saves with the dedicated token (201), a resend returns the same record (200)', async () => {
  const { server, saved, url } = await serve('vo-token');
  try {
    const created = await post(url, 'vo-token');
    assert.equal(created.status, 201);
    const first = await created.json();
    const again = await post(url, 'vo-token');
    assert.equal(again.status, 200);
    assert.equal((await again.json()).data.review.id, first.data.review.id);
    assert.equal(saved.length, 1);
    const listed = await (await fetch(url)).json();
    assert.equal(listed.data.reviews[0].id, first.data.review.id);
  } finally {
    server.close();
  }
});

test('a wrong token is 401, no configured token is 503, an unknown field is 400', async () => {
  const closed = await serve('');
  const open = await serve('vo-token');
  try {
    assert.equal((await post(closed.url, 'anything')).status, 503);
    assert.equal((await post(open.url, 'wrong')).status, 401);
    const smuggled = await post(open.url, 'vo-token', { ...REVIEW, operator: 'someone' });
    assert.equal(smuggled.status, 400);
    assert.equal(open.saved.length, 0);
  } finally {
    closed.server.close();
    open.server.close();
  }
});

test('a Cernere service token needs the ai-playtest:write scope', async () => {
  const verifier = { verify: async (token) => ({ scope: token.endsWith('ok') ? ['ai-playtest:write'] : ['persona-export:read'] }) };
  const { server, url } = await serve('', verifier);
  try {
    assert.equal((await post(url, 'v4.public.ok')).status, 201);
    assert.equal((await post(url, 'v4.public.other', { ...REVIEW, run_id: 'r2' }, 'r2')).status, 403);
  } finally {
    server.close();
  }
});
