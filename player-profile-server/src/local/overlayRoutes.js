// Loopback routes for the window overlay app
// (spec/feature/window-overlay-extension.md, task T9). Thin like
// gameInsightRoutes: the service validates, errors carry their own status.
// No CORS is added on purpose — the overlay reaches this API from its Rust
// side (content/api_client.rs), so the 127.0.0.1 boundary stays as it is.
const { Router } = require('express');
const { asAppError } = require('./localRoutes');
const { storeContext } = require('./localContext');

/** @implements SPEC-WINDOW-OVERLAY-EXTENSION */
function createOverlayRoutes({ overlayContentService, configuredContext }) {
  const router = Router();

  function handle(handler) {
    return async (req, res, next) => {
      try {
        await handler(req, res);
      } catch (error) {
        next(asAppError(error, error.statusCode || 500));
      }
    };
  }

  router.get('/status', handle(async (_req, res) => {
    const context = storeContext(await configuredContext());
    res.json({ ok: true, data: await overlayContentService.status(context) });
  }));

  router.get('/markdown', handle(async (_req, res) => {
    const context = storeContext(await configuredContext());
    res.json({ ok: true, data: await overlayContentService.documents(context) });
  }));

  router.get('/markdown/:documentId', handle(async (req, res) => {
    const context = storeContext(await configuredContext());
    res.json({ ok: true, data: await overlayContentService.document(context, req.params.documentId) });
  }));

  router.get('/charts/:kind/:recordId', handle(async (req, res) => {
    const context = storeContext(await configuredContext());
    res.json({
      ok: true,
      data: await overlayContentService.chart(context, req.params.kind, req.params.recordId),
    });
  }));

  return router;
}

module.exports = { createOverlayRoutes };
