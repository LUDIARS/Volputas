const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const {
  errorHandler,
  normalizeJsonBodyError,
} = require('./middleware/errorHandler');
const { initKeyStore } = require('./services/jwks');
const {
  createCorpusTransportRateLimiter,
  createGlabSurveyRouter,
} = require('./routes/glabSurveys');
const {
  createGlabSurveyService,
} = require('./services/glabSurveyService');

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
const memoriaRoutes = require('./routes/memoria');
const corpusManifestRoutes = require('./routes/corpusManifest');

const app = express();
const glabSurveyPath = '/api/v1/integrations/glab/surveys';
let server = null;
let stopPromise = null;
let glabSurveyService = null;

function getGlabSurveyService() {
  if (!glabSurveyService) glabSurveyService = createGlabSurveyService();
  return glabSurveyService;
}

// Security middleware
app.use(helmet());
app.use(cors(config.cors));

// Apply the unauthenticated transport abuse boundary before reading up to 1 MiB
// of JSON. This also protects malformed/oversized bodies that skip the router.
app.use(glabSurveyPath, (_req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
});
app.use(glabSurveyPath, createCorpusTransportRateLimiter());

// Body parsing
app.use(express.json({ limit: '1mb' }));
app.use(normalizeJsonBodyError);

// Corpus discovery contract (public metadata, no user data).
app.use('/.well-known/corpus-service.json', corpusManifestRoutes);

// Corpus requests are limited per verified Cernere subject inside this router.
app.use(
  glabSurveyPath,
  createGlabSurveyRouter({
    serviceProvider: getGlabSurveyService,
    transportRateLimiter: null,
  }),
);

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
app.use('/api/v1/users/me/memoria', memoriaRoutes);
app.use('/api/v1/analysis', analysisRoutes);
app.use('/api/v1', timelineRoutes);
app.use('/api/v1/delegations', delegationRoutes);

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
  if (server) return server;
  getGlabSurveyService();
  await initKeyStore();
  console.log('JWKS key store initialized');

  server = app.listen(config.port, () => {
    console.log(`Player Profile Server running on port ${config.port} [${config.nodeEnv}]`);
  });
  return server;
}

function stop() {
  if (stopPromise) return stopPromise;
  stopPromise = (async () => {
    let serverCloseError;
    try {
      if (server) {
        const activeServer = server;
        server = null;
        await new Promise((resolve, reject) => {
          activeServer.close((error) => {
            if (error) reject(error);
            else resolve();
          });
        });
      }
    } catch (error) {
      serverCloseError = error;
    }
    const activeIntegration = glabSurveyService;
    glabSurveyService = null;
    await activeIntegration?.close();
    if (serverCloseError) throw serverCloseError;
  })().finally(() => {
    stopPromise = null;
  });
  return stopPromise;
}

if (require.main === module) {
  start()
    .then(() => {
      const shutdown = () => {
        stop().then(
          () => process.exit(0),
          (error) => {
            console.error('Failed to stop server:', error);
            process.exit(1);
          },
        );
      };
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
    })
    .catch((error) => {
      console.error('Failed to start server:', error);
      process.exit(1);
    });
}

module.exports = app;
module.exports.start = start;
module.exports.stop = stop;
