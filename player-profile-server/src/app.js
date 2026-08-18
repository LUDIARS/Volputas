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
const { assertHasterConfiguration } = require('./haster/environment');
const { seedHasterPublicTestUser } = require('./haster/seedPublicTestUser');
const {
  createCorpusTransportRateLimiter,
  createGlabSurveyRouter,
} = require('./routes/glabSurveys');
const {
  createGlabSurveyService,
} = require('./services/glabSurveyService');
const { createGlabReviewService } = require('./services/glabReviewService');
const { pseudoId } = require('./services/pseudoId');
const { getProfileEvidenceStore } = require('./integrations/cernere/createProfileEvidenceStore');
const { createGlabReviewRouter } = require('./routes/glabReviews');
const { createGlabGameRouter } = require('./routes/glabGames');
const { createGlabEvidenceRouter } = require('./routes/glabEvidence');
const { createGlabGameService } = require('./services/glabGameService');
const { createGlabEvidenceService } = require('./services/glabEvidenceService');
const { ProfileMediaStore } = require('./services/profileMediaStore');
const { EmotionCurveEvaluationService } = require('./services/emotionCurveEvaluationService');
const { createLlmTextClient } = require('./services/llm/createLlmTextClient');
const { OWNER_SUBJECT, issueMediaTicket } = require('./services/mediaTicketService');
const gameModel = require('./models/gameModel');
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
const glabGamePath = '/api/v1/integrations/glab/games';
const glabEvidencePath = '/api/v1/integrations/glab/evidence';
let server = null;
let stopPromise = null;
let glabSurveyService = null;
let glabReviewService = null;
let glabGameService = null;
let glabEvidenceService = null;
let stopSessionMaintenance = null;

function getGlabSurveyService() {
  if (!glabSurveyService) glabSurveyService = createGlabSurveyService();
  return glabSurveyService;
}

// Attribution for the public review feed. The Discord relay is queued by GLAB
// itself from the 201 response of its review proxy (GLAB is the front), so
// Volputas no longer resolves an author for relaying.
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
      gameRepository: gameModel,
    });
  }
  return glabReviewService;
}

function getGlabGameService() {
  if (!glabGameService) glabGameService = createGlabGameService();
  return glabGameService;
}

function getGlabEvidenceService() {
  if (!glabEvidenceService) {
    glabEvidenceService = createGlabEvidenceService({
      evidenceStore: getProfileEvidenceStore(),
      mediaStore: new ProfileMediaStore(),
      mediaRoot: config.profileMedia.root,
      emotionCurveEvaluator: new EmotionCurveEvaluationService({
        llmClient: createLlmTextClient(),
      }),
      gameRepository: gameModel,
      // GLAB 経路の券の sub は Cernere の owner id。 自前フロントの券と混ざると
      // 別人の id を所有者として解決してしまうため、 券面に種別を刻む。
      issueTicket: ({ userId, kind, recordId }) => issueMediaTicket({
        userId,
        kind,
        recordId,
        subjectType: OWNER_SUBJECT,
      }),
    });
  }
  return glabEvidenceService;
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
app.use(glabGamePath, createCorpusTransportRateLimiter());

// 動画とゲームログは JSON ではないので、 evidence の中継は本文パーサより前に
// 置いて req をそのままストリームとして渡す。 JSON の口 (記録作成・評価) は
// content-type が application/json のときだけ express.json が拾う。
app.use(
  glabEvidencePath,
  createGlabEvidenceRouter({ serviceProvider: getGlabEvidenceService }),
);

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
    recentGamesProvider: async (cernereUserId) => {
      const user = await userModel.findByCernereSubject(cernereUserId);
      return user ? steamModel.getRecentlyPlayedGames(user.id, 20) : [];
    },
    transportRateLimiter: null,
  }),
);
app.use(
  glabGamePath,
  createGlabGameRouter({
    serviceProvider: getGlabGameService,
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
// @implements SPEC-HASTER-ISOLATION
async function start() {
  if (server) return server;
  assertOnlineConfiguration(config);
  assertHasterConfiguration(config);
  assertFrontendBuild(frontendDirectory);
  getGlabSurveyService();
  getGlabReviewService();
  if (config.haster.enabled) await seedHasterPublicTestUser();
  await initKeyStore();
  console.log('JWKS key store initialized');
  stopSessionMaintenance = startSessionMaintenance();

  // The HASTER bearer fixture is deliberately public, so its process must not
  // accept connections from the network even if a catalog is misconfigured.
  const listenHost = config.haster.enabled ? '127.0.0.1' : undefined;
  server = app.listen(config.port, listenHost, () => {
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
    glabGameService = null;
    glabEvidenceService = null;
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
