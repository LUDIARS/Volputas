const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const { errorHandler } = require('./middleware/errorHandler');
const { initKeyStore } = require('./services/jwks');
const { closeProfileEvidenceStore } = require('./integrations/cernere/createProfileEvidenceStore');
const { assertFrontendBuild, mountFrontend } = require('./services/frontendAssets');
const { assertOnlineConfiguration } = require('./services/onlineConfiguration');

// Route imports
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const profileRoutes = require('./routes/profiles');
const logRoutes = require('./routes/logs');
const surveyRoutes = require('./routes/surveys');
const analysisRoutes = require('./routes/analysis');
const steamRoutes = require('./routes/steam');
const healthRoutes = require('./routes/health');
const timelineRoutes = require('./routes/timelines');
const delegationRoutes = require('./routes/delegations');
const { router: profileEvidenceRoutes } = require('./routes/profileEvidence');

const app = express();
const frontendDirectory = path.resolve(__dirname, '../frontend/dist');

// Security middleware
app.use(helmet());
app.use(cors(config.cors));

// Body parsing
app.use(express.json({ limit: '1mb' }));

// General rate limiter
app.use(rateLimit({
  windowMs: config.rateLimit.general.windowMs,
  max: config.rateLimit.general.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: { code: 'RATE_LIMIT', message: 'Too many requests' } },
}));

// Auth routes with stricter rate limit
app.use('/auth', rateLimit({
  windowMs: config.rateLimit.login.windowMs,
  max: config.rateLimit.login.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: { code: 'RATE_LIMIT', message: 'Too many login attempts' } },
}), authRoutes);

// Health routes (no auth)
app.use('/health', healthRoutes);
app.get('/api/runtime', (_req, res) => {
  res.json({ ok: true, data: { mode: 'online', authentication: 'cernere' } });
});

// API v1 routes
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/users', profileRoutes);
app.use('/api/v1/sessions', rateLimit({
  windowMs: config.rateLimit.events.windowMs,
  max: config.rateLimit.events.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: { code: 'RATE_LIMIT', message: 'Too many events' } },
}), logRoutes);
app.use('/api/v1/surveys', surveyRoutes);
app.use('/api/v1/users/me/steam', steamRoutes);
app.use('/api/v1/analysis', analysisRoutes);
app.use('/api/v1', timelineRoutes);
app.use('/api/v1/delegations', delegationRoutes);
app.use('/api/v1/profile-data', profileEvidenceRoutes);

if (fs.existsSync(path.join(frontendDirectory, 'index.html'))) {
  mountFrontend(app, frontendDirectory);
}

// 404 handler
app.use((_req, res) => {
  res.status(404).json({
    ok: false,
    error: { code: 'NOT_FOUND', message: 'Endpoint not found' },
  });
});

// Global error handler
app.use(errorHandler);

// Start server
async function start() {
  try {
    assertOnlineConfiguration(config);
    assertFrontendBuild(frontendDirectory);
    await initKeyStore();
    console.log('JWKS key store initialized');

    const server = app.listen(config.port, () => {
      console.log(`Player Profile Server running on port ${config.port} [${config.nodeEnv}]`);
    });
    const shutdown = () => {
      closeProfileEvidenceStore();
      server.close();
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

if (require.main === module) start();

module.exports = app;
module.exports.start = start;
