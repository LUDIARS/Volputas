const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { errorHandler } = require('../middleware/errorHandler');
const { getCurrentSigningKey } = require('../services/jwks');
const { createProfileEvidenceRouter } = require('./profileEvidence');

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

async function accessToken(userId) {
  const { privateKey, kid } = await getCurrentSigningKey();
  return jwt.sign(
    { sub: userId, jti: 'voice-follow-up-route-test' },
    privateKey,
    {
      algorithm: 'RS256',
      expiresIn: '5m',
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
      keyid: kid,
    }
  );
}

function fakeModel() {
  const records = new Map([[OWNER, {
    id: 'voice-1',
    gameTitle: 'Route Test',
    comment: 'よかった',
    sentiment: null,
    polarity: null,
    playProgress: 'early',
  }]]);
  return {
    updates: [],
    async findOwned(userId, recordId) {
      const record = records.get(userId);
      return record?.id === recordId ? { kind: 'voices', ownerId: userId, record } : null;
    },
    async updateOwned(userId, kind, recordId, patch) {
      this.updates.push({ userId, kind, recordId, patch });
      const record = { ...records.get(userId), ...patch };
      records.set(userId, record);
      return record;
    },
  };
}

test('voice follow-up answers update only the caller\'s own voice', async (t) => {
  const model = fakeModel();
  const app = express();
  app.use(express.json());
  app.use('/api/v1/profile-data', createProfileEvidenceRouter({
    model,
    personaService: {},
    discussionImportService: {},
  }));
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/v1/profile-data/voices/voice-1/follow-up`;

  async function call(userId, options = {}) {
    const token = await accessToken(userId);
    return fetch(url, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    });
  }

  const question = await call(OWNER);
  assert.equal(question.status, 200);
  assert.equal((await question.json()).data.question.id, 'sentiment');

  const answered = await call(OWNER, {
    method: 'POST',
    body: JSON.stringify({ questionId: 'sentiment', answer: '0' }),
  });
  assert.equal(answered.status, 200);
  const payload = (await answered.json()).data;
  assert.equal(payload.record.sentiment, 0);
  assert.equal(payload.record.comment, 'よかった');
  assert.equal(payload.question.id, 'polarity');

  const stranger = await call(OTHER, {
    method: 'POST',
    body: JSON.stringify({ questionId: 'polarity', answer: 'like' }),
  });
  assert.equal(stranger.status, 404);

  const closed = await call(OWNER, {
    method: 'POST',
    body: JSON.stringify({ questionId: 'sentiment', answer: '1' }),
  });
  assert.equal(closed.status, 409);
  assert.equal(model.updates.length, 1);
});
