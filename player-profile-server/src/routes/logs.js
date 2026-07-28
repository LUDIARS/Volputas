const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const defaultSessionModel = require('../models/sessionModel');
const defaultEventModel = require('../models/eventModel');
const { AppError } = require('../middleware/errorHandler');
const { validateLudellusEvent } = require('../services/trialResultSchema');
const { runPostSessionJobs: defaultRunPostSessionJobs } = require('../services/sessionJobs');

// Reject malformed ludellus.* payloads (trial_result / calibration_result).
// Non-ludellus events return no errors and pass through unchanged.
function assertLudellusPayload(eventType, eventData, label = 'event_data') {
  const errors = validateLudellusEvent(eventType, eventData);
  if (errors.length > 0) {
    throw new AppError(400, 'INVALID_EVENT', `${label}: ${errors.join('; ')}`);
  }
}

// Factory so the session/event submission surface — including the
// ludellus.trial_result ingestion wiring — can be exercised with injected fakes
// (auth middleware + models) in a route-boundary test, no live DB required.
// Mirrors the createDelegationRouter dual-export pattern used elsewhere here.
function createLogsRouter({
  authenticateMiddleware = authenticate,
  sessionModel = defaultSessionModel,
  eventModel = defaultEventModel,
  runPostSessionJobs = defaultRunPostSessionJobs,
} = {}) {
  const router = Router();

  router.use(authenticateMiddleware);

  // POST /api/v1/sessions — start a play session
  router.post('/', validate({
    body: {
      game_id: { required: true, type: 'string' },
      metadata: { type: 'object' },
    },
  }), async (req, res, next) => {
    try {
      const session = await sessionModel.create({
        userId: req.user.id,
        gameId: req.body.game_id,
        metadata: req.body.metadata,
      });
      res.status(201).json({ ok: true, data: session });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/sessions/:id/heartbeat — checkpoint Spectator playtime
  router.post('/:id/heartbeat', validate({
    params: { id: { required: true, type: 'uuid' } },
    body: { occurred_at: { required: true, type: 'string' } },
  }), async (req, res, next) => {
    try {
      const elapsedMs = req.body.elapsed_ms;
      const activeMs = req.body.active_ms;
      const occurredAt = new Date(req.body.occurred_at);
      if (!Number.isSafeInteger(elapsedMs) || elapsedMs < 0
          || !Number.isSafeInteger(activeMs) || activeMs < 0 || activeMs > elapsedMs
          || !Number.isFinite(occurredAt.getTime())) {
        throw new AppError(400, 'VALIDATION_ERROR', 'heartbeat playtime or occurred_at is invalid');
      }
      const session = await sessionModel.heartbeat(req.params.id, req.user.id, {
        elapsedMs,
        activeMs,
        occurredAt: occurredAt.toISOString(),
      });
      if (!session) throw new AppError(404, 'NOT_FOUND', 'Open session not found');
      return res.json({ ok: true, data: session });
    } catch (err) {
      return next(err);
    }
  });

  // PATCH /api/v1/sessions/:id — end a session
  router.patch('/:id', validate({
    params: { id: { required: true, type: 'uuid' } },
  }), async (req, res, next) => {
    try {
      const session = await sessionModel.endSession(req.params.id, req.user.id);
      if (!session) {
        throw new AppError(404, 'NOT_FOUND', 'Session not found or already ended');
      }
      // Fire-and-forget the derived-metrics jobs (ability snapshot + content-stats
      // calibration). Best-effort: never blocks or fails the session-end response
      // (§12 session-end trigger). runPostSessionJobs swallows its own errors.
      runPostSessionJobs(session).catch(() => {});
      res.json({ ok: true, data: session });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/sessions/:id/events — single event
  router.post('/:id/events', validate({
    params: { id: { required: true, type: 'uuid' } },
    body: {
      event_type: { required: true, type: 'string' },
      event_data: { required: true, type: 'object' },
      occurred_at: { type: 'string' },
    },
  }), async (req, res, next) => {
    try {
      const session = await sessionModel.findById(req.params.id);
      if (!session || session.user_id !== req.user.id) {
        throw new AppError(404, 'NOT_FOUND', 'Session not found');
      }

      assertLudellusPayload(req.body.event_type, req.body.event_data);

      const event = await eventModel.create({
        sessionId: req.params.id,
        eventType: req.body.event_type,
        eventData: req.body.event_data,
        occurredAt: req.body.occurred_at,
      });
      res.status(201).json({ ok: true, data: event });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/sessions/:id/events/batch — batch events (the §12 trial_result path)
  router.post('/:id/events/batch', validate({
    params: { id: { required: true, type: 'uuid' } },
    body: { events: { required: true, type: 'array' } },
  }), async (req, res, next) => {
    try {
      const session = await sessionModel.findById(req.params.id);
      if (!session || session.user_id !== req.user.id) {
        throw new AppError(404, 'NOT_FOUND', 'Session not found');
      }

      req.body.events.forEach((event, i) => {
        if (!event || typeof event !== 'object') {
          throw new AppError(400, 'INVALID_EVENT', `events[${i}] must be an object`);
        }
        if (typeof event.event_type !== 'string' || !event.event_type) {
          throw new AppError(400, 'INVALID_EVENT', `events[${i}].event_type is required`);
        }
        if (!event.event_data || typeof event.event_data !== 'object' || Array.isArray(event.event_data)) {
          throw new AppError(400, 'INVALID_EVENT', `events[${i}].event_data must be an object`);
        }
        assertLudellusPayload(event.event_type, event.event_data, `events[${i}]`);
      });

      const events = await eventModel.createBatch(req.params.id, req.body.events);
      res.status(201).json({ ok: true, data: { count: events.length, events } });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/sessions — list own sessions
  router.get('/', async (req, res, next) => {
    try {
      const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);
      const offset = parseInt(req.query.offset || '0', 10);

      const result = await sessionModel.findByUserId(req.user.id, { limit, offset });
      res.json({
        ok: true,
        data: result.sessions,
        pagination: { total: result.total, limit, offset },
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/sessions/:id/events — list session events
  router.get('/:id/events', validate({
    params: { id: { required: true, type: 'uuid' } },
  }), async (req, res, next) => {
    try {
      const session = await sessionModel.findById(req.params.id);
      if (!session || session.user_id !== req.user.id) {
        throw new AppError(404, 'NOT_FOUND', 'Session not found');
      }

      const limit = Math.min(parseInt(req.query.limit || '100', 10), 1000);
      const offset = parseInt(req.query.offset || '0', 10);

      const events = await eventModel.findBySessionId(req.params.id, { limit, offset });
      res.json({ ok: true, data: events });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = createLogsRouter();
module.exports.createLogsRouter = createLogsRouter;
