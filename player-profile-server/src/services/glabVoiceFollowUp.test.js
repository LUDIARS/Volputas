const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');
const { createGlabReviewService } = require('./glabReviewService');
const { createGlabReviewRouter } = require('../routes/glabReviews');
const { errorHandler } = require('../middleware/errorHandler');
const { validateGlabVoiceInput } = require('./profileEvidenceSchemas');

// GLAB で書いた感想に Voluptas 本体と同じ追加ヒアリング・体験解析を通す (SPEC-GLAB-VOICE-FOLLOW-UP)。

const OWNER = 'cernere-owner-1';
const OTHER = 'cernere-owner-2';

function ownerStoreWith(records) {
  const byOwner = new Map(Object.entries(records));
  return {
    async findForOwner(ownerId, recordId) {
      const list = byOwner.get(ownerId) ?? [];
      const found = list.find((item) => item.record.id === recordId);
      return found ? { kind: found.kind, ownerId, record: found.record } : null;
    },
    async updateForOwner(ownerId, kind, recordId, patch) {
      const list = byOwner.get(ownerId) ?? [];
      const found = list.find((item) => item.kind === kind && item.record.id === recordId);
      if (!found) return null;
      found.record = { ...found.record, ...patch };
      return found.record;
    },
  };
}

function glabVoice(overrides = {}) {
  return { id: 'v1', userId: OWNER, ...validateGlabVoiceInput({ gameTitle: 'Uni Quest', comment: 'よかった' }), ...overrides };
}

function serviceWith(records) {
  return createGlabReviewService({
    voiceStore: { async listVoices() { return []; }, async saveVoice(value) { return value; } },
    resolveDisplayName: async () => 'Alice',
    pseudoId: () => 'pseudo',
    gameRepository: { async findById() { return null; } },
    ownerStore: ownerStoreWith(records),
  });
}

test('a GLAB review without progress is asked for progress first, one question at a time', async () => {
  const service = serviceWith({ [OWNER]: [{ kind: 'voices', record: glabVoice() }] });
  assert.equal((await service.followUp(OWNER, 'v1')).question.id, 'playProgress');
  const answered = await service.answerFollowUp(OWNER, 'v1', { questionId: 'playProgress', answer: 'middle' });
  assert.equal(answered.record.playProgress, 'middle');
  // 感情は未回答 (null) のまま。0 (中立) と取り違えない。
  assert.equal(answered.record.sentiment, null);
  assert.equal(answered.question.id, 'sentiment');
  // 原文は変えない。
  assert.equal(answered.record.comment, 'よかった');
});

test('a skipped question is not asked again and a closed question is refused', async () => {
  const service = serviceWith({ [OWNER]: [{ kind: 'voices', record: glabVoice({ playProgress: 'early' }) }] });
  const skipped = await service.answerFollowUp(OWNER, 'v1', { questionId: 'sentiment', skip: true });
  assert.notEqual(skipped.question?.id, 'sentiment');
  await assert.rejects(
    service.answerFollowUp(OWNER, 'v1', { questionId: 'sentiment', answer: 1 }),
    (error) => error.code === 'FOLLOW_UP_NOT_OPEN',
  );
});

test('only the owner\'s own voice record is reachable', async () => {
  const service = serviceWith({
    [OWNER]: [{ kind: 'voices', record: glabVoice() }, { kind: 'surveys', record: { id: 's1' } }],
  });
  await assert.rejects(service.followUp(OTHER, 'v1'), (error) => error.statusCode === 404);
  await assert.rejects(service.followUp(OWNER, 's1'), (error) => error.statusCode === 404);
  await assert.rejects(service.saveAnalysis(OTHER, 'v1', { version: 1 }), (error) => error.statusCode === 404);
  const saved = await service.saveAnalysis(OWNER, 'v1', { version: 1 });
  assert.deepEqual(saved.experienceAnalysis, { version: 1 });
});

async function withApp(service, analysisService, exercise, ownerId = OWNER) {
  const app = express();
  app.use(express.json());
  const pass = (req, _res, next) => { req.cernereUser = { id: ownerId }; next(); };
  app.use('/reviews', createGlabReviewRouter({
    authMiddleware: pass, transportRateLimiter: pass, userRateLimiter: pass,
    serviceProvider: () => service, analysisService,
  }));
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await exercise(`http://127.0.0.1:${server.address().port}/reviews`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('the GLAB routes answer follow-ups and map closed questions to 409 and others\' records to 404', async () => {
  const service = serviceWith({ [OWNER]: [{ kind: 'voices', record: glabVoice({ playProgress: 'early' }) }] });
  await withApp(service, null, async (base) => {
    const next = await (await fetch(`${base}/v1/follow-up`)).json();
    assert.equal(next.data.question.id, 'sentiment');
    const answer = await fetch(`${base}/v1/follow-up`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ questionId: 'sentiment', answer: 0 }),
    });
    assert.equal(answer.status, 200);
    assert.equal((await answer.json()).data.record.sentiment, 0);
    const again = await fetch(`${base}/v1/follow-up`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ questionId: 'sentiment', answer: 1 }),
    });
    assert.equal(again.status, 409);
    assert.equal((await fetch(`${base}/missing/follow-up`)).status, 404);
  });
  await withApp(service, null, async (base) => {
    assert.equal((await fetch(`${base}/v1/follow-up`)).status, 404);
  }, OTHER);
});

test('the GLAB analysis route requires consent and saves the result on the owner\'s record', async () => {
  const service = serviceWith({ [OWNER]: [{ kind: 'voices', record: glabVoice({ playProgress: 'early' }) }] });
  const analyses = [];
  const analysisService = {
    status: (record, analysis) => ({ recordId: record.id, analysis }),
    async analyze(record) {
      const { sourceRevision } = require('./voiceAnalysis/source');
      const analysis = { sourceRevision: sourceRevision(record), result: 'ok' };
      analyses.push(analysis);
      return analysis;
    },
  };
  await withApp(service, analysisService, async (base) => {
    const refused = await fetch(`${base}/analysis/v1`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(refused.status, 400);
    const done = await fetch(`${base}/analysis/v1`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ consent: true }),
    });
    assert.equal(done.status, 200);
    assert.equal((await done.json()).data.analysis.result, 'ok');
    assert.equal((await (await fetch(`${base}/analysis/v1`)).json()).data.analysis.result, 'ok');
  });
  assert.equal(analyses.length, 1);
});
