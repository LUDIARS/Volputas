const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');
const { errorHandler } = require('../middleware/errorHandler');
const { createGlabReviewRouter } = require('./glabReviews');

const OWNER = 'ba8e37c8-0f60-4f22-9c1a-6b0a7cbd7e01';

function passThrough(req, _res, next) {
  req.cernereUser ??= { id: OWNER };
  next();
}

async function withRouter(router, exercise) {
  const app = express();
  app.use(express.json());
  app.use('/reviews', router);
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const { port } = server.address();
    await exercise(`http://127.0.0.1:${port}/reviews`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => {
      if (error) reject(error);
      else resolve();
    }));
  }
}

function routerFor(service) {
  return createGlabReviewRouter({
    authMiddleware: passThrough,
    transportRateLimiter: passThrough,
    userRateLimiter: passThrough,
    serviceProvider: () => service,
  });
}

test('created review response preserves the GLAB relay queue fields', async () => {
  const record = {
    id: 'review-1',
    glabProjectId: 'project-1',
    gameTitle: 'Uni Quest',
    recommend: true,
    comment: 'Excellent combat.',
    visibility: 'community',
    anonymous: true,
  };
  let receivedUserId;
  let receivedBody;
  const service = {
    async create(userId, body) {
      receivedUserId = userId;
      receivedBody = body;
      return record;
    },
  };

  await withRouter(routerFor(service), async (baseUrl) => {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ comment: 'client input' }),
    });
    const payload = await response.json();

    assert.equal(response.status, 201);
    assert.deepEqual(payload, { ok: true, data: { record } });
  });

  assert.equal(receivedUserId, OWNER);
  assert.deepEqual(receivedBody, { comment: 'client input' });
});
