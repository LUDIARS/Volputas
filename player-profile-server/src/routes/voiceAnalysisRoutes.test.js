const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { getCurrentSigningKey } = require('../services/jwks');
const { errorHandler } = require('../middleware/errorHandler');
const { createProfileEvidenceRouter } = require('./profileEvidence');
const { createLocalVoiceAnalysisRoutes } = require('../local/voiceAnalysisRoutes');
const { VoiceAnalysisService } = require('../services/voiceAnalysis/voiceAnalysisService');

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const response = { text: JSON.stringify({ observations: [], events: [], order: [], links: [], unclassified: [] }), model: 'fake' };
async function listen(t, router) {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}
async function token(userId) {
  const { privateKey, kid } = await getCurrentSigningKey();
  return jwt.sign({ sub: userId, jti: 'voice-analysis-test' }, privateKey, {
    algorithm: 'RS256', expiresIn: '5m', issuer: config.jwt.issuer, audience: config.jwt.audience, keyid: kid,
  });
}

test('authenticated analysis requires consent and ownership, preserves source, reuses results and detects edits', async (t) => {
  let record = { id: 'voice-1', comment: '楽しかった', followUps: [] };
  let calls = 0;
  let updates = 0;
  let editDuringGeneration = false;
  const service = new VoiceAnalysisService({ llmClient: {
    isConfigured: () => true,
    generate: async () => {
      calls += 1;
      if (editDuringGeneration) record = { ...record, comment: '解析中に変更' };
      return response;
    },
  } });
  const model = {
    findOwned: async (userId, id) => userId === OWNER && id === record.id ? { kind: 'voices', record } : null,
    updateOwned: async (_userId, _kind, _id, patch) => {
      updates += 1; record = { ...record, ...patch }; return record;
    },
  };
  const origin = await listen(t, createProfileEvidenceRouter({
    model, personaService: {}, discussionImportService: {}, emotionCurveEvaluator: {}, voiceAnalysisService: service,
  }));
  const ownerToken = await token(OWNER);
  const otherToken = await token(OTHER);
  const url = `${origin}/voice-analysis/voice-1`;
  const call = (bearer = ownerToken, body) => fetch(url, {
    headers: { Authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
  });
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await call(otherToken, { consent: true })).status, 404);
  assert.equal((await call(ownerToken, {})).status, 400);
  assert.equal(calls, 0);
  const first = await call(ownerToken, { consent: true });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('cache-control'), 'private, no-store');
  assert.equal((await first.json()).data.state, 'complete');
  assert.equal(record.comment, '楽しかった');
  assert.deepEqual(record.followUps, []);
  assert.equal((await call(ownerToken, { consent: true })).status, 200);
  assert.equal(calls, 1);
  assert.equal(updates, 1);
  record = { ...record, followUps: [{ questionId: 'reason', answer: '理由を追加' }] };
  assert.equal((await (await call()).json()).data.state, 'stale');
  editDuringGeneration = true;
  assert.equal((await call(ownerToken, { consent: true })).status, 409);
  assert.equal(updates, 1);
});

test('local analysis uses a separate store and becomes unavailable after owner/source removal', async (t) => {
  let record = { id: 'voice-1', comment: '感想', respondent: { name: 'tester' } };
  let stored = null;
  const writes = [];
  const service = new VoiceAnalysisService({ llmClient: { isConfigured: () => true, generate: async () => response } });
  const origin = await listen(t, createLocalVoiceAnalysisRoutes({
    service,
    configuredContext: async () => ({ config: { name: 'tester' }, gitAuthor: { repositoryRoot: '/private' } }),
    voiceStore: { read: async () => record },
    analysisStore: { read: async () => stored, write: async (input) => { writes.push(input); stored = input.data; } },
  }));
  const url = `${origin}/voice-1`;
  assert.equal((await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"consent":true}' })).status, 200);
  assert.equal(record.experienceAnalysis, undefined);
  assert.equal(writes[0].name, 'tester');
  assert.equal(stored.voiceId, record.id);
  record = { ...record, respondent: { name: 'other' } };
  assert.equal((await fetch(url)).status, 404);
  record = null;
  assert.equal((await fetch(url)).status, 404);
});
