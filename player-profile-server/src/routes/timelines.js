const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');
const db = require('../config/database');
const {
  aggregatePlaySession,
  getTimeline,
  listTimelines,
  saveTimeline,
} = require('../services/affectTimeline');
const {
  createBeatScriptVersion,
  getBeatScript,
} = require('../services/beatScript');
const { computeTimelineGap } = require('../services/timelineGap');

const router = Router();
router.use(authenticate);

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AppError(400, 'INVALID_INPUT', `${name} must be a positive integer`);
  }
  return parsed;
}

router.get('/games/:gameId/timelines', async (req, res, next) => {
  try {
    res.json({ ok: true, data: await listTimelines(req.params.gameId) });
  } catch (error) {
    next(error);
  }
});

router.get('/timelines/:id', async (req, res, next) => {
  try {
    const timeline = await getTimeline(positiveInteger(req.params.id, 'timeline id'));
    if (!timeline) throw new AppError(404, 'NOT_FOUND', 'Timeline not found');
    res.json({ ok: true, data: timeline });
  } catch (error) {
    next(error);
  }
});

router.put('/games/:gameId/beat-script', async (req, res, next) => {
  try {
    const beats = Array.isArray(req.body) ? req.body : req.body?.beats;
    const script = await createBeatScriptVersion(req.params.gameId, beats);
    res.status(201).json({ ok: true, data: script });
  } catch (error) {
    if (error instanceof TypeError) return next(new AppError(400, 'INVALID_BEAT_SCRIPT', error.message));
    return next(error);
  }
});

router.get('/games/:gameId/beat-script', async (req, res, next) => {
  try {
    const version = req.query.version === undefined
      ? undefined
      : positiveInteger(req.query.version, 'beat version');
    const script = await getBeatScript(req.params.gameId, version);
    if (!script) throw new AppError(404, 'NOT_FOUND', 'Beat script not found');
    res.json({ ok: true, data: script });
  } catch (error) {
    next(error);
  }
});

router.get('/games/:gameId/timelines/:id/gap', async (req, res, next) => {
  try {
    const [timeline, script] = await Promise.all([
      getTimeline(positiveInteger(req.params.id, 'timeline id')),
      getBeatScript(
        req.params.gameId,
        req.query.beatVersion === undefined
          ? undefined
          : positiveInteger(req.query.beatVersion, 'beatVersion')
      ),
    ]);
    if (!timeline || timeline.game_id !== req.params.gameId) {
      throw new AppError(404, 'NOT_FOUND', 'Timeline not found for game');
    }
    if (!script) throw new AppError(404, 'NOT_FOUND', 'Beat script not found');
    if (timeline.source_kind !== 'video_comments') {
      throw new AppError(400, 'UNSUPPORTED_TIMELINE', 'Gap vectors require a viewer-reaction timeline');
    }
    res.json({
      ok: true,
      data: {
        timelineId: timeline.id,
        beatVersion: script.version,
        ...computeTimelineGap(timeline.series, script.beats),
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/sessions/:id/timeline', async (req, res, next) => {
  try {
    const binMs = req.body?.binMs === undefined ? 30_000 : positiveInteger(req.body.binMs, 'binMs');
    const { rows } = await db.query(
      `SELECT ps.game_id, ps.started_at, pe.event_type, pe.event_data, pe.occurred_at
       FROM play_sessions ps
       LEFT JOIN play_events pe ON pe.session_id = ps.id
       WHERE ps.id = $1 AND ps.user_id = $2
       ORDER BY pe.occurred_at, pe.id`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'Session not found');
    const events = rows
      .filter((row) => row.event_type)
      .map((row) => ({
        monoMs: Number(row.event_data?.mono_ms)
          || new Date(row.occurred_at).getTime() - new Date(row.started_at).getTime(),
        eventType: row.event_type,
        eventData: row.event_data,
      }));
    const series = aggregatePlaySession(events, binMs);
    const timeline = await saveTimeline({
      gameId: rows[0].game_id,
      sourceKind: 'play_session',
      sourceRef: req.params.id,
      binMs,
      series,
      meta: { events: events.length },
    });
    res.status(201).json({ ok: true, data: timeline });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
