// Loopback routes for the cross-player game insight
// (spec/feature/game-insight.md §API). Thin like narrativeArcRoutes: inputs are
// validated in the service, errors carry their own status codes.
const { Router } = require('express');
const { asAppError } = require('./localRoutes');
const { storeContext } = require('./localContext');

/** @implements SPEC-GAME-INSIGHT */
function createGameInsightRoutes({ gameInsightService, configuredContext }) {
  const router = Router();

  function requireJson(req, _res, next) {
    if (req.is('application/json')) return next();
    return next(asAppError(Object.assign(new Error('Content-Type must be application/json'), {
      code: 'JSON_CONTENT_TYPE_REQUIRED',
    }), 415));
  }

  function handle(handler, fallbackStatus = 500) {
    return async (req, res, next) => {
      try {
        await handler(req, res);
      } catch (error) {
        next(asAppError(error, error.statusCode || fallbackStatus));
      }
    };
  }

  router.get('/games', handle(async (_req, res) => {
    const context = storeContext(await configuredContext());
    res.json({ ok: true, data: await gameInsightService.games(context) });
  }));

  router.get('/status', handle(async (_req, res) => {
    res.json({ ok: true, data: gameInsightService.status() });
  }));

  router.get('/', handle(async (_req, res) => {
    const context = storeContext(await configuredContext());
    res.json({ ok: true, data: await gameInsightService.list(context) });
  }));

  router.post('/analyze', requireJson, handle(async (req, res) => {
    const context = storeContext(await configuredContext());
    const record = await gameInsightService.analyze(context, { gameTitle: req.body?.gameTitle });
    res.status(201).json({ ok: true, data: record });
  }));

  router.get('/:id', handle(async (req, res) => {
    const context = storeContext(await configuredContext());
    res.json({ ok: true, data: await gameInsightService.find(context, req.params.id) });
  }));

  router.get('/:id/capture-sessions', handle(async (req, res) => {
    const context = storeContext(await configuredContext());
    res.json({ ok: true, data: await gameInsightService.captureSessionCandidates(context, req.params.id) });
  }));

  // LLM proposal; 502 by default because a failure here is usually the
  // upstream generator (or Anatomia / ffmpeg), matching the evaluate routes.
  router.post('/:id/propose', requireJson, handle(async (req, res) => {
    const context = storeContext(await configuredContext());
    res.json({
      ok: true,
      data: await gameInsightService.propose(context, req.params.id, {
        anatomiaProject: req.body?.anatomiaProject,
        captureSessionId: req.body?.captureSessionId,
      }),
    });
  }, 502));

  return router;
}

module.exports = { createGameInsightRoutes };
