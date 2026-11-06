const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');
const { errorHandler } = require('../middleware/errorHandler');
const { createGlabEvidenceRouter } = require('./glabEvidence');
const { createGlabDelegation } = require('../integrations/cernere/glabDelegation');
const { createHash } = require('node:crypto');

const OWNER = 'ba8e37c8-0f60-4f22-9c1a-6b0a7cbd7e01';

function passThrough(req, _res, next) {
  req.cernereUser ??= { id: OWNER };
  next();
}

async function withRouter(router, exercise) {
  const app = express();
  app.use('/evidence', router);
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const { port } = server.address();
    const request = (url, init = {}) => fetch(url, { ...init, headers: {
      authorization: `${init.method === 'PUT' ? 'Cernere-Upload' : 'Cernere-Delegation'} ${'a'.repeat(43)}`,
      'x-cernere-request-id': '22222222-2222-4222-8222-222222222222', ...init.headers,
    } });
    await exercise(`http://127.0.0.1:${port}/evidence`, request);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => {
      if (error) reject(error);
      else resolve();
    }));
  }
}

function routerFor(service, overrides = {}) {
  const composite = async () => {
    const { CompositeDelegations } = await import('../../vendor/cernere-composite/dist/delegation.js');
    const { CompositeUploads } = await import('../../vendor/cernere-composite/dist/upload.js');
    const expiresAt = new Date(Date.now() + 4_000).toISOString();
    const authority = async (action, operation) => {
      const metadata = { allowed: true, user: { id: OWNER, role: 'general', displayName: 'Fixture', email: null },
        projectKey: 'voluptas', sourceProject: 'glab', expiresAt, requestId: operation.requestId,
        risk: operation.action.startsWith('evidence.curves.read') || operation.action === 'evidence.media.read' || operation.action === 'evidence.media.ticket'
          ? 'sensitive_read' : 'important' };
      if (action === 'begin-upload') return { ...metadata, receipt: 'r'.repeat(43), limits: { maximumBytes: 2 * 1024 ** 3, timeoutSeconds: 5 },
        byteLength: 5, contentDigest: createHash('sha256').update('video').digest('base64url') };
      if (action === 'cancel-upload') return {};
      return metadata;
    };
    return { delegations: new CompositeDelegations(authority, 'voluptas'), uploads: new CompositeUploads(authority, 'voluptas') };
  };
  return createGlabEvidenceRouter({
    delegation: createGlabDelegation({ composite }),
    transportRateLimiter: passThrough,
    userRateLimiter: passThrough,
    serviceProvider: () => ({ authorizeMedia: async () => true, authorizeEmotionCurve: async () => true, ...service }),
    ...overrides,
  });
}

test('invalid emotion-curve input is returned as a 400 contract error', async () => {
  const service = {
    createEmotionCurve: async () => {
      throw Object.assign(new Error('Game title is required'), {
        code: 'INVALID_PROFILE_INPUT',
      });
    },
  };

  await withRouter(routerFor(service), async (baseUrl, request) => {
    const response = await request(`${baseUrl}/emotion-curves`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.error.code, 'INVALID_PROFILE_INPUT');
  });
});

test('unsupported upload media is returned as a 400 contract error', async () => {
  const service = {
    saveCapturedMedia: async () => {
      throw Object.assign(new Error('Unsupported media type'), {
        code: 'UNSUPPORTED_MEDIA_TYPE',
      });
    },
  };

  await withRouter(routerFor(service), async (baseUrl, request) => {
    const response = await request(`${baseUrl}/media/videos/record-1`, {
      method: 'PUT',
      headers: { 'content-type': 'image/png' },
      body: 'not a video',
    });
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.error.code, 'UNSUPPORTED_MEDIA_TYPE');
  });
});

test('an unexpected upload failure does not disclose its internal path', async () => {
  const service = {
    saveCapturedMedia: async () => {
      throw Object.assign(new Error('internal-media-path-sentinel'), { code: 'EACCES' });
    },
  };

  await withRouter(routerFor(service), async (baseUrl, request) => {
    const response = await request(`${baseUrl}/media/videos/record-1`, {
      method: 'PUT',
      headers: { 'content-type': 'video/mp4' },
      body: 'video',
    });
    const payload = await response.json();

    assert.equal(response.status, 500);
    assert.equal(payload.error.code, 'EACCES');
    assert.equal(payload.error.message, 'Internal server error');
    assert.equal(JSON.stringify(payload).includes('internal-media-path-sentinel'), false);
  });
});

test('an evaluator failure does not disclose upstream diagnostics', async () => {
  const service = {
    evaluateEmotionCurve: async () => {
      throw new Error('upstream-diagnostic-sentinel');
    },
  };

  await withRouter(routerFor(service), async (baseUrl, request) => {
    const response = await request(`${baseUrl}/emotion-curves/record-1/evaluate`, {
      method: 'POST',
    });
    const payload = await response.json();

    assert.equal(response.status, 502);
    assert.equal(payload.error.code, 'EVALUATION_FAILED');
    assert.equal(payload.error.message, 'Emotion curve evaluation failed');
    assert.equal(JSON.stringify(payload).includes('upstream-diagnostic-sentinel'), false);
  });
});

test('legacy project Bearer and ticket-only requests cannot replace current delegation', async () => {
  let read = false, ticketVerified = false;
  const router = routerFor({ listEmotionCurves: async () => { read = true; return []; } }, {
    verifyTicket: async () => { ticketVerified = true; return { sub: OWNER, kind: 'videos', recordId: 'record-1' }; },
  });
  await withRouter(router, async baseUrl => {
    const old = await fetch(`${baseUrl}/emotion-curves`, { headers: { authorization: 'Bearer old-global-or-project-token' } });
    assert.equal(old.status, 401);
    const ticket = await fetch(`${baseUrl}/media/videos/record-1?ticket=old`);
    assert.equal(ticket.status, 401);
  });
  assert.equal(read, false); assert.equal(ticketVerified, false);
});

test('ticket playback crosses the transport rate-limit boundary', async () => {
  let ticketVerified = false;
  const limiter = (_req, res) => res.status(429).json({ ok: false });
  const router = routerFor({}, {
    transportRateLimiter: limiter,
    verifyTicket: async () => {
      ticketVerified = true;
      return { sub: OWNER, kind: 'videos', recordId: 'record-1' };
    },
  });

  await withRouter(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/media/videos/record-1?ticket=x`);

    assert.equal(response.status, 429);
    assert.equal(ticketVerified, false);
  });
});
