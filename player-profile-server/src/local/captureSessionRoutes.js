// Loopback (desktop UI / game) routes for capture sessions. The LAN-facing
// companion endpoints live in companionApp.js; this router is only mounted on
// the 127.0.0.1 local app.
const { Router } = require('express');
const { asAppError } = require('./localRoutes');
const { storeContext } = require('./localContext');
const {
  validateMarkerInput,
  validateSignalInput,
  validateStartInput,
} = require('../services/captureSession/captureSessionSchemas');

function createCaptureSessionRoutes({ captureSessionService, configuredContext, companionInfo }) {
  const router = Router();

  function requireJson(req, _res, next) {
    if (req.is('application/json')) return next();
    return next(asAppError(Object.assign(new Error('Content-Type must be application/json'), {
      code: 'JSON_CONTENT_TYPE_REQUIRED',
    }), 415));
  }

  function handle(handler) {
    return async (req, res, next) => {
      try {
        await handler(req, res);
      } catch (error) {
        const defaultStatus = error.code === 'INVALID_CAPTURE_INPUT' ? 400 : 500;
        next(asAppError(error, error.statusCode || defaultStatus));
      }
    };
  }

  router.get('/companion/status', handle(async (_req, res) => {
    res.json({ ok: true, data: companionInfo() });
  }));

  router.get('/active', handle(async (_req, res) => {
    const context = storeContext(await configuredContext());
    res.json({ ok: true, data: await captureSessionService.active(context) });
  }));

  router.post('/active/markers', requireJson, handle(async (req, res) => {
    const context = storeContext(await configuredContext());
    await captureSessionService.initialize(context);
    const record = await captureSessionService.addMarker('desktop', validateMarkerInput(req.body));
    res.status(201).json({ ok: true, data: record });
  }));

  router.post('/active/stop', requireJson, handle(async (req, res) => {
    const context = storeContext(await configuredContext());
    await captureSessionService.initialize(context);
    res.json({ ok: true, data: await captureSessionService.stop(req.body || {}) });
  }));

  router.post('/active/pairing', requireJson, handle(async (_req, res) => {
    const context = storeContext(await configuredContext());
    await captureSessionService.initialize(context);
    res.status(201).json({ ok: true, data: await captureSessionService.issuePairing() });
  }));

  router.post('/signal', requireJson, handle(async (req, res) => {
    const context = storeContext(await configuredContext());
    const input = validateSignalInput(req.body);
    const record = await captureSessionService.handleSignal(context, input);
    res.status(input.action === 'start' ? 201 : 200).json({ ok: true, data: record });
  }));

  router.get('/', handle(async (_req, res) => {
    const context = storeContext(await configuredContext());
    res.json({ ok: true, data: await captureSessionService.list(context) });
  }));

  router.post('/', requireJson, handle(async (req, res) => {
    const context = storeContext(await configuredContext());
    const record = await captureSessionService.start(
      context,
      validateStartInput(req.body),
      'manual'
    );
    res.status(201).json({ ok: true, data: record });
  }));

  router.get('/:id/timeline', handle(async (req, res) => {
    const context = storeContext(await configuredContext());
    res.json({ ok: true, data: await captureSessionService.timeline(context, req.params.id) });
  }));

  router.get('/:id/audio', handle(async (req, res) => {
    const context = storeContext(await configuredContext());
    const media = await captureSessionService.resolveAudio(context, req.params.id);
    if (!media) {
      throw Object.assign(new Error('Session audio not found'), {
        statusCode: 404,
        code: 'MEDIA_NOT_FOUND',
      });
    }
    res.type(media.contentType);
    res.sendFile(media.filePath);
  }));

  return router;
}

module.exports = { createCaptureSessionRoutes };
