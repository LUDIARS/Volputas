const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const {
  errorHandler,
  normalizeJsonBodyError,
} = require('./middleware/errorHandler');
const { initKeyStore } = require('./services/jwks');
const { startSessionMaintenance } = require('./services/sessionMaintenance');
const { closeProfileEvidenceStore } = require('./integrations/cernere/createProfileEvidenceStore');
const { assertFrontendBuild, mountFrontend } = require('./services/frontendAssets');
const { assertOnlineConfiguration } = require('./services/onlineConfiguration');
const {
  createCorpusTransportRateLimiter,
  createGlabSurveyRouter,
} = require('./routes/glabSurveys');
const {
  createGlabSurveyService,
} = require('./services/glabSurveyService');
const { createGlabReviewService } = require('./services/glabReviewService');
const { createReviewRelayService } = require('./services/reviewRelayService');
const { createGlabRelayClient } = require('./integrations/glab/glabRelayClient');
const { pseudoId } = require('./services/pseudoId');
const { getProfileEvidenceStore } = require('./integrations/cernere/createProfileEvidenceStore');
const { createGlabReviewRouter } = require('./routes/glabReviews');
const steamModel = require('./models/steamModel');
const userModel = require('./models/userModel');

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
const tuningRoutes = require('./routes/tuning');
const abilityRoutes = require('./routes/ability');
const delegationRoutes = require('./routes/delegations');
const impressionRoutes = require('./routes/impressions');
const impressionReactionRoutes = require('./routes/impressionReactions');
const memoriaRoutes = require('./routes/memoria');
const corpusManifestRoutes = require('./routes/corpusManifest');
const { router: personaExportRoutes } = require('./routes/personaExport');
const { router: profileEvidenceRoutes } = require('./routes/profileEvidence');

const app = express();
const frontendDirectory = path.resolve(__dirname, '../frontend/dist');
const glabSurveyPath = '/api/v1/integrations/glab/surveys';
const glabReviewPath = '/api/v1/integrations/glab/reviews';
let server = null;
let stopPromise = null;
let glabSurveyService = null;
let glabReviewService = null;
let reviewRelayService = null;
let stopSessionMaintenance = null;

function getGlabSurveyService() {
  if (!glabSurveyService) glabSurveyService = createGlabSurveyService();
  return glabSurveyService;
}

// Shared by the public review feed and the Discord relay so both attribute a
// review the same way.
async function resolveGlabReviewAuthor(cernereUserId, record) {
  if (record.displayName) return record.displayName;
  const user = await userModel.findByCernereSubject(cernereUserId);
  return user?.display_name || 'Player';
}

function getGlabReviewService() {
  if (!glabReviewService) {
    const store = getProfileEvidenceStore();
    glabReviewService = createGlabReviewService({
      voiceStore: {
        listVoices: (query) => store.listPublicVoices(query),
        saveVoice: (voice) => store.createForOwner(voice.userId, 'voices', voice),
      },
      resolveDisplayName: resolveGlabReviewAuthor,
      pseudoId: (userId) => pseudoId(userId, config.pseudoIdSecret),
    });
  }
  return glabReviewService;
}

function getReviewRelayService() {
  if (!reviewRelayService) {
    const store = getProfileEvidenceStore();
    // Every piece of the relay path is optional config; without all of it the
    // service stays wired but degrades to "not relayed" instead of failing.
    const glabRelayClient = createGlabRelayClient({
      baseUrl: config.glab.baseUrl,
      serviceToken: config.glab.serviceToken,
    });
    reviewRelayService = createReviewRelayService({
      glabRelayClient,
      voiceStore: {
        // record.userId is the Cernere owner id stamped by createForOwner, not a
        // local user id, so it must not go through the local-id resolution path.
        markRelayed: (id, relayedAt, record) => store.updateForOwner(
          record.userId,
          'voices',
          id,
          { relayedAt },
        ),
      },
      logger: console,
      reviewBaseUrl: config.frontendUrl,
    });
  }
  return reviewRelayService;
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
app.use(glabReviewPath, createCorpusTransportRateLimiter());

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
app.use(
  glabReviewPath,
  createGlabReviewRouter({
    serviceProvider: getGlabReviewService,
    reviewRelayServiceProvider: getReviewRelayService,
    authorNameProvider: resolveGlabReviewAuthor,
    recentGamesProvider: async (cernereUserId) => {
      const user = await userModel.findByCernereSubject(cernereUserId);
      return user ? steamModel.getRecentlyPlayedGames(user.id, 20) : [];
    },
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
app.use('/api/v1/users/me/memoria', memoriaRoutes);
app.use('/api/v1/analysis', analysisRoutes);
app.use('/api/v1', timelineRoutes);
app.use('/api/v1', tuningRoutes);
app.use('/api/v1', abilityRoutes);
app.use('/api/v1/delegations', delegationRoutes);
app.use('/api/v1', impressionRoutes);
app.use('/api/v1', impressionReactionRoutes);
app.use('/api/v1/profile-data', profileEvidenceRoutes);
app.use('/api/personas', personaExportRoutes);

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
  if (server) return server;
  assertOnlineConfiguration(config);
  assertFrontendBuild(frontendDirectory);
  getGlabSurveyService();
  getGlabReviewService();
  await initKeyStore();
  console.log('JWKS key store initialized');
  stopSessionMaintenance = startSessionMaintenance();

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
    stopSessionMaintenance?.();
    stopSessionMaintenance = null;
    closeProfileEvidenceStore();
    const activeIntegration = glabSurveyService;
    glabSurveyService = null;
    glabReviewService = null;
    reviewRelayService = null;
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
