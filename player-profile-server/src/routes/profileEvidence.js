const fs = require('node:fs/promises');
const { Router } = require('express');
const config = require('../config');
const { authenticate } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');
const { getProfileEvidenceStore } = require('../integrations/cernere/createProfileEvidenceStore');
const { EXPERIENCE_CARDS } = require('../services/personaEvidence/experienceCards');
const {
  validateCardSortInput,
  validateComparisonInput,
  validateEmotionCurveInput,
  validateGameplayInput,
  validateVoiceInput,
} = require('../services/profileEvidenceSchemas');
const { ProfileMediaStore } = require('../services/profileMediaStore');
const { OnlinePersonaService } = require('../services/onlinePersonaService');
const { issueMediaTicket, verifyMediaTicket } = require('../services/mediaTicketService');
const { createLlmTextClient } = require('../services/llm/createLlmTextClient');
const { EmotionCurveEvaluationService } = require('../services/emotionCurveEvaluationService');

const MEDIA_RECORD_KIND = {
  screenshots: 'gameplay',
  videos: 'emotion-curves',
  gamelogs: 'emotion-curves',
};

function asInputError(error) {
  if (error instanceof AppError) return error;
  return new AppError(400, error.code || 'INVALID_PROFILE_INPUT', error.message);
}

function createProfileEvidenceRouter({
  model = getProfileEvidenceStore(),
  mediaStore = new ProfileMediaStore(),
  personaService,
  emotionCurveEvaluator,
  mediaRoot = config.profileMedia.root,
  issueTicket = issueMediaTicket,
  verifyTicket = verifyMediaTicket,
} = {}) {
  const router = Router();
  const resolvedPersonaService = personaService || new OnlinePersonaService(model);
  const resolvedEmotionCurveEvaluator = emotionCurveEvaluator
    || new EmotionCurveEvaluationService({ llmClient: createLlmTextClient() });

  router.get('/media/:kind/:recordId', async (req, res, next) => {
    try {
      const ticket = await verifyTicket(req.query.ticket);
      if (
        ticket.kind !== req.params.kind
        || ticket.recordId !== req.params.recordId
      ) {
        throw new AppError(403, 'MEDIA_TICKET_MISMATCH', 'Media ticket does not match this file');
      }
      const record = await model.findOwned(ticket.sub, req.params.recordId);
      const metadata = record
        ? await model.findMedia(ticket.sub, req.params.recordId, req.params.kind)
        : null;
      if (!record || !metadata || MEDIA_RECORD_KIND[req.params.kind] !== record.kind) {
        throw new AppError(404, 'MEDIA_NOT_FOUND', 'Media not found');
      }
      const media = await mediaStore.resolve({
        repositoryRoot: mediaRoot,
        name: record.ownerId,
        kind: req.params.kind,
        recordId: req.params.recordId,
      });
      if (!media) throw new AppError(404, 'MEDIA_NOT_FOUND', 'Media not found');
      res.type(media.contentType);
      return res.sendFile(media.filePath);
    } catch (error) {
      if (
        error.code === 'INVALID_MEDIA_TICKET'
        || error.name === 'TokenExpiredError'
        || error.name === 'JsonWebTokenError'
      ) {
        return next(new AppError(401, 'INVALID_MEDIA_TICKET', 'Media ticket is invalid or expired'));
      }
      return next(error);
    }
  });

  router.use(authenticate);

  function collectionRoutes(routePath, kind, validate) {
    router.get(routePath, async (req, res, next) => {
      try {
        return res.json({ ok: true, data: await model.list(req.user.id, kind) });
      } catch (error) {
        return next(error);
      }
    });
    router.post(routePath, async (req, res, next) => {
      try {
        const record = await model.create(req.user.id, kind, validate(req.body));
        return res.status(201).json({ ok: true, data: { record } });
      } catch (error) {
        return next(asInputError(error));
      }
    });
  }

  collectionRoutes('/gameplay', 'gameplay', validateGameplayInput);
  collectionRoutes('/voices', 'voices', validateVoiceInput);
  collectionRoutes('/emotion-curves', 'emotion-curves', validateEmotionCurveInput);
  collectionRoutes('/comparisons', 'comparisons', validateComparisonInput);
  collectionRoutes('/card-sorts', 'card-sorts', validateCardSortInput);

  router.get('/comparisons/deck', (_req, res) => {
    res.json({ ok: true, data: EXPERIENCE_CARDS.map(({ id, text }) => ({ id, text })) });
  });

  router.post('/emotion-curves/:recordId/evaluate', async (req, res, next) => {
    try {
      const owned = await model.findOwned(req.user.id, req.params.recordId);
      if (!owned || owned.kind !== 'emotion-curves') {
        throw new AppError(404, 'PROFILE_RECORD_NOT_FOUND', 'Emotion curve not found');
      }
      const persona = await model.readAnalysis(req.user.id);
      const media = await mediaStore.resolve({
        repositoryRoot: mediaRoot,
        name: owned.ownerId,
        kind: 'gamelogs',
        recordId: req.params.recordId,
      });
      const gameLogText = media ? await fs.readFile(media.filePath, 'utf8') : null;
      const evaluation = await resolvedEmotionCurveEvaluator.evaluate({
        record: owned.record,
        persona,
        gameLogText,
      });
      const record = await model.updateOwned(
        req.user.id,
        'emotion-curves',
        req.params.recordId,
        { evaluation }
      );
      if (!record) {
        throw new AppError(404, 'PROFILE_RECORD_NOT_FOUND', 'Emotion curve not found');
      }
      return res.json({ ok: true, data: { record } });
    } catch (error) {
      if (error instanceof AppError) return next(error);
      return next(new AppError(
        error.statusCode || 502,
        error.code || 'EVALUATION_FAILED',
        error.message
      ));
    }
  });

  router.put('/media/:kind/:recordId', async (req, res, next) => {
    try {
      const record = await model.findOwned(req.user.id, req.params.recordId);
      if (!record || MEDIA_RECORD_KIND[req.params.kind] !== record.kind) {
        throw new AppError(404, 'PROFILE_RECORD_NOT_FOUND', 'Profile record not found');
      }
      const contentType = String(req.headers['content-type'] || '').split(';')[0].trim();
      const mediaContext = {
        repositoryRoot: mediaRoot,
        name: record.ownerId,
        kind: req.params.kind,
        recordId: req.params.recordId,
      };
      const result = await mediaStore.save({
        ...mediaContext,
        contentType,
        stream: req,
      });
      try {
        await model.saveMedia(req.user.id, {
          recordId: req.params.recordId,
          kind: req.params.kind,
          contentType: result.contentType,
          bytes: result.bytes,
        });
      } catch (error) {
        await mediaStore.remove(mediaContext).catch(() => {
          // Best-effort cleanup: preserve the Cernere failure as the primary error.
        });
        throw error;
      }
      return res.status(201).json({
        ok: true,
        data: { bytes: result.bytes, contentType: result.contentType },
      });
    } catch (error) {
      return next(asInputError(error));
    }
  });

  router.get('/media/:kind/:recordId/ticket', async (req, res, next) => {
    try {
      const record = await model.findOwned(req.user.id, req.params.recordId);
      const metadata = record
        ? await model.findMedia(req.user.id, req.params.recordId, req.params.kind)
        : null;
      if (!record || !metadata || MEDIA_RECORD_KIND[req.params.kind] !== record.kind) {
        throw new AppError(404, 'MEDIA_NOT_FOUND', 'Media not found');
      }
      const ticket = await issueTicket({
        userId: req.user.id,
        kind: req.params.kind,
        recordId: req.params.recordId,
      });
      return res.json({
        ok: true,
        data: {
          url: `/api/v1/profile-data/media/${req.params.kind}/${req.params.recordId}`
            + `?ticket=${encodeURIComponent(ticket)}`,
        },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/persona', async (req, res, next) => {
    try {
      return res.json({ ok: true, data: await resolvedPersonaService.status(req.user.id) });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/persona/analyze', async (req, res, next) => {
    try {
      return res.json({ ok: true, data: await resolvedPersonaService.analyze(req.user.id) });
    } catch (error) {
      return next(asInputError(error));
    }
  });

  return router;
}

module.exports = {
  MEDIA_RECORD_KIND,
  createProfileEvidenceRouter,
  router: createProfileEvidenceRouter(),
};
