const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const sessionModel = require('../models/sessionModel');
const eventModel = require('../models/eventModel');
const { AppError } = require('../middleware/errorHandler');

const router = Router();

router.use(authenticate);

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

// PATCH /api/v1/sessions/:id — end a session
router.patch('/:id', validate({
  params: { id: { required: true, type: 'uuid' } },
}), async (req, res, next) => {
  try {
    const session = await sessionModel.endSession(req.params.id, req.user.id);
    if (!session) {
      throw new AppError(404, 'NOT_FOUND', 'Session not found or already ended');
    }
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

// POST /api/v1/sessions/:id/events/batch — batch events
router.post('/:id/events/batch', validate({
  params: { id: { required: true, type: 'uuid' } },
  body: { events: { required: true, type: 'array' } },
}), async (req, res, next) => {
  try {
    const session = await sessionModel.findById(req.params.id);
    if (!session || session.user_id !== req.user.id) {
      throw new AppError(404, 'NOT_FOUND', 'Session not found');
    }

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

module.exports = router;
