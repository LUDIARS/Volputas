// Loopback routes for the cross-session narrative arc
// (spec/feature/narrative-arc.md §API). Thin: validation of the one input
// (gameTitle) happens in the service, errors carry their own status codes.
const { Router } = require('express');
const { asAppError } = require('./localRoutes');
const { storeContext } = require('./localContext');

/** @implements SPEC-NARRATIVE-ARC */
function createNarrativeArcRoutes({ narrativeArcService, configuredContext }) {
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
    res.json({ ok: true, data: await narrativeArcService.games(context) });
  }));

  router.get('/status', handle(async (_req, res) => {
    res.json({
      ok: true,
      data: { evaluation: { configured: narrativeArcService.isEvaluationConfigured() } },
    });
  }));

  router.get('/', handle(async (_req, res) => {
    const context = storeContext(await configuredContext());
    res.json({ ok: true, data: await narrativeArcService.list(context) });
  }));

  router.post('/analyze', requireJson, handle(async (req, res) => {
    const context = storeContext(await configuredContext());
    const record = await narrativeArcService.analyze(context, { gameTitle: req.body?.gameTitle });
    res.status(201).json({ ok: true, data: record });
  }));

  router.get('/:id', handle(async (req, res) => {
    const context = storeContext(await configuredContext());
    res.json({ ok: true, data: await narrativeArcService.find(context, req.params.id) });
  }));

  // LLM commentary; 502 by default because a failure here is usually the
  // upstream generator, matching the emotion-curve evaluate route.
  router.post('/:id/evaluate', requireJson, handle(async (req, res) => {
    const context = storeContext(await configuredContext());
    res.json({ ok: true, data: await narrativeArcService.evaluate(context, req.params.id) });
  }, 502));

  return router;
}

module.exports = { createNarrativeArcRoutes };
