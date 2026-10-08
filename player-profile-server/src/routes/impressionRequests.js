const { Router } = require('express');
const { createImpressionRequestAuth } = require('../middleware/impressionRequestAuth');
const { createImpressionRequestRepository } = require('../models/impressionRequestRepository');
const { AppError } = require('../middleware/errorHandler');

const isRequestId = (value) => typeof value === 'string' && /^[A-Za-z0-9:_-]{1,180}$/.test(value);

/** @implements SPEC-IMPRESSION-COLLECTION-REQUEST — 受付は収集完了と別。保存完了後だけ受付を返す。 */
function createImpressionRequestsRouter({ authenticateMiddleware = createImpressionRequestAuth(), repository = createImpressionRequestRepository() } = {}) {
  const router = Router();
  router.use(authenticateMiddleware);
  router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
  router.post('/', async (req, res, next) => {
    const { requestId, theme } = req.body || {};
    if (!isRequestId(requestId) || typeof theme !== 'string' || !theme.trim() || theme.length > 2000) {
      return next(new AppError(400, 'INVALID_IMPRESSION_REQUEST', 'requestId and theme (1-2000 characters) are required'));
    }
    try {
      const result = await repository.accept(req.impressionRequester, requestId, theme.trim());
      if (!result.request) throw new Error('Accepted request could not be read');
      if (result.request.theme !== theme.trim()) return next(new AppError(409, 'IMPRESSION_REQUEST_CONFLICT', 'requestId already has a different theme'));
      return res.status(result.created ? 201 : 200).json({ ok: true, data: { request: result.request } });
    } catch (error) { return next(error); }
  });
  router.get('/', async (req, res, next) => {
    try { return res.json({ ok: true, data: { requests: await repository.list(req.impressionRequester) } }); }
    catch (error) { return next(error); }
  });
  router.get('/:requestId', async (req, res, next) => {
    if (!isRequestId(req.params.requestId)) return next(new AppError(400, 'INVALID_IMPRESSION_REQUEST', 'Invalid requestId'));
    try {
      const request = await repository.find(req.impressionRequester, req.params.requestId);
      if (!request) return next(new AppError(404, 'IMPRESSION_REQUEST_NOT_FOUND', 'Request not found'));
      return res.json({ ok: true, data: { request } });
    } catch (error) { return next(error); }
  });
  return router;
}

module.exports = { createImpressionRequestsRouter };
