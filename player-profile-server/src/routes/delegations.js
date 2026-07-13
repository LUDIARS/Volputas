const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { requireRecentAuthentication } = require('../middleware/recentAuth');
const { validate } = require('../middleware/validate');
const { createDelegationService } = require('../services/delegationService');
const { ALLOWED_PROFILE_FIELDS, PLAYSTYLE_TAGS } = require('../services/delegationPolicy');

const uuidParam = validate({ params: { id: { required: true, type: 'uuid' } } });
const claimUuidParam = validate({ params: { claimId: { required: true, type: 'uuid' } } });

function createDelegationRouter({
  authenticateMiddleware = authenticate,
  recentAuthMiddleware = requireRecentAuthentication(),
  service = createDelegationService(),
} = {}) {
  const router = Router();
  router.use(authenticateMiddleware);

  router.get('/schema', (_req, res) => {
    res.json({
      ok: true,
      data: {
        allowed_fields: ALLOWED_PROFILE_FIELDS,
        playstyle_tags: PLAYSTYLE_TAGS,
        preference_range: { min: -1, max: 1 },
        free_text_allowed: false,
      },
    });
  });

  router.post('/', recentAuthMiddleware, async (req, res, next) => {
    try {
      const result = await service.createGrant(req.user.id, req.body);
      res.set('Cache-Control', 'no-store');
      res.status(201).json({
        ok: true,
        data: { grant: result.grant, invite_token: result.inviteToken },
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/accept', recentAuthMiddleware, async (req, res, next) => {
    try {
      const grant = await service.acceptInvite(req.user.id, req.body?.invite_token);
      res.json({ ok: true, data: grant });
    } catch (error) {
      next(error);
    }
  });

  router.post('/preview', async (req, res, next) => {
    try {
      const grant = await service.previewInvite(req.body?.invite_token);
      res.json({ ok: true, data: grant });
    } catch (error) {
      next(error);
    }
  });

  router.get('/', async (req, res, next) => {
    try {
      const grants = await service.listGrants(req.user.id, req.query.direction || 'outgoing');
      res.json({ ok: true, data: grants });
    } catch (error) {
      next(error);
    }
  });

  router.post('/:id/revoke', uuidParam, recentAuthMiddleware, async (req, res, next) => {
    try {
      const grant = await service.revokeGrant(req.user.id, req.params.id);
      res.json({ ok: true, data: grant });
    } catch (error) {
      next(error);
    }
  });

  router.post('/:id/leave', uuidParam, recentAuthMiddleware, async (req, res, next) => {
    try {
      const grant = await service.leaveGrant(req.user.id, req.params.id);
      res.json({ ok: true, data: grant });
    } catch (error) {
      next(error);
    }
  });

  router.post('/:id/claims', uuidParam, async (req, res, next) => {
    try {
      const claims = await service.proposeClaims(req.user.id, req.params.id, req.body?.claims);
      res.status(201).json({ ok: true, data: claims });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id/claims', uuidParam, async (req, res, next) => {
    try {
      const claims = await service.listClaims(req.user.id, req.params.id);
      res.json({ ok: true, data: claims });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id/audit', uuidParam, async (req, res, next) => {
    try {
      const events = await service.listAudit(req.user.id, req.params.id);
      res.json({ ok: true, data: events });
    } catch (error) {
      next(error);
    }
  });

  router.post('/claims/:claimId/decision', claimUuidParam, recentAuthMiddleware, async (req, res, next) => {
    try {
      const claim = await service.decideClaim(req.user.id, req.params.claimId, req.body?.decision);
      res.json({ ok: true, data: claim });
    } catch (error) {
      next(error);
    }
  });

  router.post('/claims/:claimId/withdraw', claimUuidParam, async (req, res, next) => {
    try {
      const claim = await service.withdrawClaim(req.user.id, req.params.claimId);
      res.json({ ok: true, data: claim });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = createDelegationRouter();
module.exports.createDelegationRouter = createDelegationRouter;
