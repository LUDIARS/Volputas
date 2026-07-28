const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { errorHandler } = require('../middleware/errorHandler');
const { createLogsRouter } = require('./logs');

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';
const SESSION = '44444444-4444-4444-8444-444444444444';

// Minimal §6.4 trial_result event_data that satisfies validateTrialResult.
function validTrial(overrides = {}) {
  return {
    v: 1,
    seq: 1,
    trial_id: 't-1',
    item_id: 'vocab_ja_00123',
    item_version: 3,
    presented_mono_ms: 1230000,
    first_input_ms: 480,
    response_ms: 2350,
    outcome: 'correct',
    score: 1,
    item_snapshot: { text_len: 24, vocab_level: 4, kanji_ratio: 0.35, difficulty: 0.62 },
    ...overrides,
  };
}

// Build an app with injected fakes: a stub auth middleware (x-test-user header),
// an in-memory session owned by USER, and event models that record their calls.
function buildApp() {
  const calls = { created: [], batched: [] };
  const sessionModel = {
    async findById(id) {
      return id === SESSION ? { id, user_id: USER } : null;
    },
  };
  const eventModel = {
    async create(event) {
      calls.created.push(event);
      return { id: 'evt-1', ...event };
    },
    async createBatch(sessionId, events) {
      calls.batched.push({ sessionId, events });
      return events.map((e, i) => ({ id: `evt-${i}`, ...e }));
    },
  };
  const auth = (req, res, next) => {
    const id = req.headers['x-test-user'];
    if (!id) return res.status(401).json({ ok: false, error: { code: 'UNAUTHORIZED' } });
    req.user = { id };
    next();
  };
  const app = express();
  app.use(express.json());
  app.use('/api/v1/sessions', createLogsRouter({ authenticateMiddleware: auth, sessionModel, eventModel }));
  app.use(errorHandler);
  return { app, calls };
}

async function withServer(t, app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}/api/v1/sessions`;
}

function post(base, path, body, userId = USER) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-user': userId },
    body: JSON.stringify(body),
  });
}

test('single event: a valid ludellus.trial_result is accepted and stored', async (t) => {
  const { app, calls } = buildApp();
  const base = await withServer(t, app);
  const res = await post(base, `/${SESSION}/events`, {
    event_type: 'ludellus.trial_result',
    event_data: validTrial(),
  });
  assert.equal(res.status, 201);
  assert.equal(calls.created.length, 1);
  assert.equal(calls.created[0].eventType, 'ludellus.trial_result');
});

test('single event: a malformed trial_result is rejected at the route boundary (400)', async (t) => {
  const { app, calls } = buildApp();
  const base = await withServer(t, app);
  // Missing item_id and an out-of-enum outcome -> validator errors.
  const res = await post(base, `/${SESSION}/events`, {
    event_type: 'ludellus.trial_result',
    event_data: { trial_id: 't-2', presented_mono_ms: 1000, outcome: 'nope' },
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, 'INVALID_EVENT');
  assert.equal(calls.created.length, 0, 'invalid payload must not reach the model');
});

test('batch: a trial_result carrying raw free-text in answer_detail is rejected (privacy §11)', async (t) => {
  const { app, calls } = buildApp();
  const base = await withServer(t, app);
  const res = await post(base, `/${SESSION}/events/batch`, {
    events: [{
      event_type: 'ludellus.trial_result',
      event_data: validTrial({ answer_detail: { text: 'ユーザーの生入力テキスト' } }),
    }],
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error.message, /answer_detail/);
  assert.equal(calls.batched.length, 0);
});

test('batch: valid trial_result mixed with a non-ludellus event is accepted', async (t) => {
  const { app, calls } = buildApp();
  const base = await withServer(t, app);
  const res = await post(base, `/${SESSION}/events/batch`, {
    events: [
      { event_type: 'ludellus.trial_result', event_data: validTrial() },
      { event_type: 'level_clear', event_data: { level: 3 } },
    ],
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.data.count, 2);
  assert.equal(calls.batched.length, 1);
  assert.equal(calls.batched[0].events.length, 2);
});

test('batch: one bad trial_result rejects the whole batch (idempotent all-or-nothing)', async (t) => {
  const { app, calls } = buildApp();
  const base = await withServer(t, app);
  const res = await post(base, `/${SESSION}/events/batch`, {
    events: [
      { event_type: 'ludellus.trial_result', event_data: validTrial() },
      { event_type: 'ludellus.trial_result', event_data: { trial_id: 'x' } },
    ],
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error.message, /events\[1\]/);
  assert.equal(calls.batched.length, 0);
});

test('submission is rejected for a session the caller does not own (404)', async (t) => {
  const { app, calls } = buildApp();
  const base = await withServer(t, app);
  const res = await post(base, `/${SESSION}/events`, {
    event_type: 'ludellus.trial_result',
    event_data: validTrial(),
  }, OTHER);
  assert.equal(res.status, 404);
  assert.equal(calls.created.length, 0);
});
