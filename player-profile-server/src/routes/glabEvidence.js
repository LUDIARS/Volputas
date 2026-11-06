const { Router } = require('express');
const { AppError, asInputError } = require('../middleware/errorHandler');
const { createGlabDelegation } = require('../integrations/cernere/glabDelegation');
const { MEDIA_RULES } = require('../services/profileMediaStore');
const { OWNER_SUBJECT, verifyMediaTicket } = require('../services/mediaTicketService');
const { createCorpusTransportRateLimiter, createCorpusUserRateLimiter } = require('./corpusRateLimits');

const INPUT_ERROR_CODES = new Set(['INVALID_PROFILE_INPUT', 'INVALID_PROFILE_PATH', 'MEDIA_TOO_LARGE', 'UNSUPPORTED_MEDIA_TYPE']);
const TICKET_ERROR_NAMES = new Set(['TokenExpiredError', 'JsonWebTokenError']);
function requestError(error) { return INPUT_ERROR_CODES.has(error?.code) ? asInputError(error) : error; }
function parseBody(body) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)); }
  catch { throw new AppError(400, 'INVALID_JSON', 'Malformed JSON request body'); }
}

function rateAllowed(limiter, req, res) {
  if (!limiter) return Promise.resolve(true);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (allowed, error) => {
      if (settled) return;
      settled = true; res.off('finish', blocked); res.off('close', blocked);
      if (error) reject(error); else resolve(allowed);
    };
    const blocked = () => finish(false);
    res.once('finish', blocked); res.once('close', blocked);
    try { limiter(req, res, error => finish(!error, error)); }
    catch (error) { finish(false, error); }
  });
}

/** Current one-operation authority plus current Voluptas owner ACL.
 * @implements SPEC-GLAB-EVIDENCE-MEDIA-TRANSPORT SPEC-GLAB-SCOPED-EVIDENCE-UPLOAD
 */
function createGlabEvidenceRouter({
  delegation = createGlabDelegation(),
  transportRateLimiter = createCorpusTransportRateLimiter(),
  userRateLimiter = createCorpusUserRateLimiter(),
  serviceProvider,
  verifyTicket = verifyMediaTicket,
} = {}) {
  if (!serviceProvider) throw new TypeError('serviceProvider is required');
  const router = Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
  if (transportRateLimiter) router.use(transportRateLimiter);

  const protect = (action, risk, authorize, execute) => async (req, res, next) => {
    try {
      return await delegation.run(req, res, { action, risk,
        authorizeResource: decision => authorize(serviceProvider(), decision.user.id, req),
        execute: async (body, decision) => {
          req.cernereUser = { ...decision.user };
          if (!await rateAllowed(userRateLimiter, req, res)) return;
          return execute(serviceProvider(), decision.user.id, req, res, body);
        },
      });
    } catch (error) { return next(requestError(error)); }
  };
  const ownerScope = async () => true;
  const mediaScope = (stored = false) => (service, ownerId, req) => service.authorizeMedia(ownerId, {
    kind: req.params.kind, recordId: req.params.recordId, requireStored: stored,
  });

  router.get('/emotion-curves', protect('evidence.curves.read', 'sensitive_read', ownerScope,
    async (service, ownerId, _req, res) => res.json({ ok: true, data: await service.listEmotionCurves(ownerId) })));
  router.post('/emotion-curves', protect('evidence.curves.create', 'important', ownerScope,
    async (service, ownerId, _req, res, body) => res.status(201).json({ ok: true, data: {
      record: await service.createEmotionCurve(ownerId, parseBody(body)),
    } })));
  router.post('/emotion-curves/:recordId/evaluate', protect('evidence.evaluate', 'important',
    (service, ownerId, req) => service.authorizeEmotionCurve(ownerId, req.params.recordId),
    async (service, ownerId, req, res) => {
      try { return res.json({ ok: true, data: { record: await service.evaluateEmotionCurve(ownerId, req.params.recordId) } }); }
      catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError(502, 'EVALUATION_FAILED', 'Emotion curve evaluation failed');
      }
    }));

  router.put('/media/:kind/:recordId', async (req, res, next) => {
    try {
      const rule = MEDIA_RULES[req.params.kind];
      const contentType = String(req.headers['content-type'] || '').split(';')[0].trim();
      if (!rule?.contentTypes[contentType]) throw new AppError(400, 'UNSUPPORTED_MEDIA_TYPE', 'Unsupported media type');
      return await delegation.upload(req, res, { limits: { maximumBytes: rule.maximumBytes, timeoutSeconds: 300 },
        authorizeResource: decision => mediaScope()(serviceProvider(), decision.user.id, req),
        execute: async (captured, decision, owner) => {
          req.cernereUser = { ...decision.user };
          if (!await rateAllowed(userRateLimiter, req, res)) return;
          const result = await serviceProvider().saveCapturedMedia(decision.user.id, {
            kind: req.params.kind, recordId: req.params.recordId, contentType, captured, owner,
          });
          return res.status(201).json({ ok: true, data: result });
        },
      });
    } catch (error) { return next(requestError(error)); }
  });

  router.get('/media/:kind/:recordId/ticket', protect('evidence.media.ticket', 'sensitive_read', mediaScope(true),
    async (service, ownerId, req, res) => {
      const ticket = await service.issueMediaTicket(ownerId, { kind: req.params.kind, recordId: req.params.recordId });
      return res.json({ ok: true, data: { url: `/api/v1/integrations/glab/evidence/media/${req.params.kind}`
        + `/${req.params.recordId}?ticket=${encodeURIComponent(ticket)}` } });
    }));
  router.get('/media/:kind/:recordId', protect('evidence.media.read', 'sensitive_read', mediaScope(true),
    async (service, ownerId, req, res) => {
      let ticket;
      try { ticket = await verifyTicket(req.query.ticket, { subjectType: OWNER_SUBJECT }); }
      catch (error) {
        if (error?.code === 'INVALID_MEDIA_TICKET' || TICKET_ERROR_NAMES.has(error?.name)) {
          throw new AppError(401, 'INVALID_MEDIA_TICKET', 'Media ticket is invalid or expired');
        }
        throw error;
      }
      if (ticket.sub !== ownerId || ticket.kind !== req.params.kind || ticket.recordId !== req.params.recordId) {
        throw new AppError(403, 'MEDIA_TICKET_MISMATCH', 'Media ticket does not match this owner and file');
      }
      const media = await service.resolveMedia(ownerId, { kind: req.params.kind, recordId: req.params.recordId });
      res.type(media.contentType);
      // Await the response lifecycle so request-owner resources survive streaming.
      return new Promise((resolve, reject) => res.sendFile(media.filePath, error => error ? reject(error) : resolve()));
    }));
  return router;
}

module.exports = { createGlabEvidenceRouter };
