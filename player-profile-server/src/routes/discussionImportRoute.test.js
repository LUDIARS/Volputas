const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { errorHandler } = require('../middleware/errorHandler');
const { getCurrentSigningKey } = require('../services/jwks');
const { createProfileEvidenceRouter } = require('./profileEvidence');

async function accessToken(userId) {
  const { privateKey, kid } = await getCurrentSigningKey();
  return jwt.sign(
    { sub: userId, jti: 'discussion-route-test' },
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

test('authenticated discussion sync endpoint invokes the guarded import service', async (t) => {
  const calls = [];
  const app = express();
  app.use(express.json());
  app.use('/api/v1/profile-data', createProfileEvidenceRouter({
    model: {},
    personaService: {},
    discussionImportService: {
      async sync(userId) {
        calls.push(userId);
        return { received: 2, imported: 1, duplicate: 1 };
      },
    },
  }));
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));

  const token = await accessToken('11111111-1111-4111-8111-111111111111');
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/api/v1/profile-data/discussion-voices/sync`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}` } }
  );
  assert.equal(response.status, 200);
  assert.deepEqual(calls, ['11111111-1111-4111-8111-111111111111']);
  assert.deepEqual((await response.json()).data, {
    received: 2,
    imported: 1,
    duplicate: 1,
  });
});
