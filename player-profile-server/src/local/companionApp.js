// LAN-facing Express app for iPhone companions. Kept separate from the
// loopback local app on purpose: the local app carries the whole unauthenticated
// profile API, while this app exposes only pairing-token-guarded capture
// endpoints plus the companion page (spec/feature/emotion-capture-companion.md).
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { randomBytes } = require('node:crypto');
const { COMPANION_PAGE_HTML } = require('./companionPage');
const {
  validateAudioMetaInput,
  validateGazeBatchInput,
  validateJoinInput,
  validateMarkerInput,
  validateSyncInput,
} = require('../services/captureSession/captureSessionSchemas');

const PAIRING_RATE_LIMIT = Object.freeze({ windowMs: 60 * 1000, max: 5 });
const CSP_NONCE_PLACEHOLDER = '__COMPANION_SCRIPT_NONCE__';

function errorResponse(error) {
  if (error?.type === 'entity.parse.failed') {
    return {
      statusCode: 400,
      payload: {
        ok: false,
        error: { code: 'INVALID_JSON', message: 'Malformed JSON request body' },
      },
    };
  }
  if (error?.type === 'entity.too.large') {
    return {
      statusCode: 413,
      payload: {
        ok: false,
        error: { code: 'REQUEST_TOO_LARGE', message: 'Request body is too large' },
      },
    };
  }
  const isInputError = error.code === 'INVALID_CAPTURE_INPUT';
  const statusCode = error.statusCode || (isInputError ? 400 : 500);
  const isInternal = statusCode >= 500;
  return {
    statusCode,
    payload: {
      ok: false,
      error: {
        code: isInternal ? 'COMPANION_OPERATION_FAILED' : error.code,
        message: isInternal ? 'Companion operation failed' : error.message,
      },
    },
  };
}

function createCompanionApp({ captureSessionService }) {
  const app = express();
  app.use((_req, res, next) => {
    res.locals.cspNonce = randomBytes(16).toString('base64');
    res.set('Cache-Control', 'private, no-store');
    next();
  });
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        scriptSrc: ["'self'", (_req, res) => `'nonce-${res.locals.cspNonce}'`],
      },
    },
  }));
  // Gaze batches are the largest JSON payload (2000 samples ≈ 150KB).
  app.use(express.json({ limit: '2mb' }));

  app.get('/', (_req, res) => {
    res.type('html').send(
      COMPANION_PAGE_HTML.replace(CSP_NONCE_PLACEHOLDER, res.locals.cspNonce)
    );
  });

  const pairingRateLimiter = rateLimit({
    ...PAIRING_RATE_LIMIT,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: {
      ok: false,
      error: { code: 'PAIRING_RATE_LIMITED', message: 'Too many pairing attempts' },
    },
  });

  app.post('/api/join', pairingRateLimiter, async (req, res) => {
    try {
      const { code } = validateJoinInput(req.body);
      const { token, deviceId, record } = await captureSessionService.join(code);
      return res.status(201).json({
        ok: true,
        data: {
          token,
          deviceId,
          session: { id: record.id, gameTitle: record.gameTitle, startedAt: record.startedAt },
        },
      });
    } catch (error) {
      const response = errorResponse(error);
      return res.status(response.statusCode).json(response.payload);
    }
  });

  function bearerToken(req) {
    const header = String(req.headers.authorization || '');
    if (!header.startsWith('Bearer ')) {
      throw Object.assign(new Error('Companion token is required'), {
        statusCode: 401,
        code: 'INVALID_COMPANION_TOKEN',
      });
    }
    return header.slice('Bearer '.length);
  }

  function handle(handler) {
    return async (req, res) => {
      try {
        await handler(req, res, bearerToken(req));
      } catch (error) {
        const response = errorResponse(error);
        res.status(response.statusCode).json(response.payload);
      }
    };
  }

  app.get('/api/session', handle(async (_req, res, token) => {
    res.json({ ok: true, data: captureSessionService.companionState(token) });
  }));

  app.post('/api/sync', handle(async (req, res, token) => {
    res.json({ ok: true, data: captureSessionService.sync(token, validateSyncInput(req.body)) });
  }));

  app.post('/api/gaze', handle(async (req, res, token) => {
    const result = await captureSessionService.ingestGaze(token, validateGazeBatchInput(req.body));
    res.status(202).json({ ok: true, data: result });
  }));

  app.post('/api/markers', handle(async (req, res, token) => {
    const record = await captureSessionService.companionMarker(token, validateMarkerInput(req.body));
    res.status(201).json({ ok: true, data: { markers: record.markers.length } });
  }));

  app.put('/api/audio', handle(async (req, res, token) => {
    const contentType = String(req.headers['content-type'] || '').split(';')[0].trim();
    const { durationSeconds } = validateAudioMetaInput(req.headers);
    const result = await captureSessionService.attachAudio(token, {
      contentType,
      stream: req,
      durationSeconds,
    });
    res.status(201).json({ ok: true, data: result });
  }));

  app.use((_req, res) => {
    res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Endpoint not found' } });
  });
  app.use((error, _req, res, _next) => {
    const response = errorResponse(error);
    res.status(response.statusCode).json(response.payload);
  });

  return app;
}

module.exports = { createCompanionApp };
