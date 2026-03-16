const { Router } = require('express');
const db = require('../config/database');

const router = Router();

// GET /health — liveness check
router.get('/', (_req, res) => {
  res.json({ ok: true, data: { status: 'healthy', timestamp: new Date().toISOString() } });
});

// GET /health/ready — readiness check (includes DB)
router.get('/ready', async (_req, res) => {
  try {
    const start = Date.now();
    await db.query('SELECT 1');
    const dbLatencyMs = Date.now() - start;

    res.json({
      ok: true,
      data: {
        status: 'ready',
        checks: {
          database: { status: 'up', latency_ms: dbLatencyMs },
        },
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    res.status(503).json({
      ok: false,
      error: {
        code: 'NOT_READY',
        message: 'Service not ready',
        checks: {
          database: { status: 'down', error: err.message },
        },
      },
    });
  }
});

// GET /metrics — basic metrics endpoint
router.get('/metrics', async (_req, res) => {
  try {
    const [usersResult, sessionsResult, eventsResult] = await Promise.all([
      db.query('SELECT COUNT(*) AS count FROM users WHERE is_deleted = false'),
      db.query('SELECT COUNT(*) AS count FROM play_sessions'),
      db.query('SELECT COUNT(*) AS count FROM play_events'),
    ]);

    res.json({
      ok: true,
      data: {
        users_total: parseInt(usersResult.rows[0].count, 10),
        sessions_total: parseInt(sessionsResult.rows[0].count, 10),
        events_total: parseInt(eventsResult.rows[0].count, 10),
        uptime_seconds: Math.floor(process.uptime()),
        memory_usage_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: { code: 'METRICS_ERROR', message: 'Failed to collect metrics' },
    });
  }
});

module.exports = router;
