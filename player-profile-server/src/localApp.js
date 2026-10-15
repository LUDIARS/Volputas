require('./config/legacyEnvAliases');
const express = require('express');
const helmet = require('helmet');
const path = require('node:path');
const { LocalConfigStore } = require('./local/localConfigStore');
const { GitCli } = require('./local/gitCli');
const { GitAuthorReader } = require('./local/gitAuthorReader');
const { DataRepositoryVisibilityChecker } = require('./local/dataRepositoryVisibility');
const { GitSurveyPublisher } = require('./local/gitSurveyPublisher');
const { LocalResponseStore } = require('./local/localResponseStore');
const { SurveyDefinitionStore } = require('./local/surveyDefinitionStore');
const { createLocalRoutes } = require('./local/localRoutes');
const { PersonaService } = require('./local/personaService');
const { createLlmTextClient } = require('./services/llm/createLlmTextClient');
const { EmotionCurveEvaluationService } = require('./services/emotionCurveEvaluationService');
const { ProfileMediaStore } = require('./services/profileMediaStore');
const { assertFrontendBuild, mountFrontend } = require('./services/frontendAssets');
const { createEvidenceStores } = require('./local/createEvidenceStores');
const { createConfiguredContext, storeContext } = require('./local/localContext');
const { createCaptureSessionRoutes } = require('./local/captureSessionRoutes');
const {
  createCaptureAnalysisService,
  createCaptureSessionService,
} = require('./local/captureSessionComposition');
const { createCompanionApp } = require('./local/companionApp');
const { createNarrativeArcRoutes } = require('./local/narrativeArcRoutes');
const { NarrativeArcService } = require('./services/narrativeArc/narrativeArcService');
const { createGameInsightRoutes } = require('./local/gameInsightRoutes');
const { createOverlayRoutes } = require('./local/overlayRoutes');
const { OverlayContentService } = require('./services/overlay/overlayContentService');
const { OverlayMarkdownStore } = require('./services/overlay/overlayMarkdownStore');
const { createGameInsightService } = require('./local/gameInsightComposition');
const { createLocalVoiceAnalysisRoutes } = require('./local/voiceAnalysisRoutes');
const { VoiceAnalysisService } = require('./services/voiceAnalysis/voiceAnalysisService');
const { ProfileRecordStore } = require('./local/profileRecordStore');
const { LocalAiPlaytestReviewStore } = require('./local/localAiPlaytestReviewStore');
const { createAiPlaytestReviewRouter } = require('./routes/aiPlaytestReviews');
const { createAiPlaytestAuth } = require('./middleware/aiPlaytestAuth');
const { createAiPlaytestReviewService } = require('./services/aiPlaytest/aiPlaytestReviewService');
const {
  companionStatus,
  readCompanionConfig,
  startCompanionListener,
} = require('./local/companionListener');
const config = require('./config');
const { LocalPopulationReportService } = require('./services/populationReport');
const { errorHandler } = require('./middleware/errorHandler');

function createLocalApp({
  configStore = new LocalConfigStore(),
  gitCli = new GitCli(),
  gitAuthorReader = new GitAuthorReader(),
  dataRepositoryVisibilityChecker = new DataRepositoryVisibilityChecker(),
  emotionCurveEvaluator,
  evidenceStores = createEvidenceStores(),
  mediaStore = new ProfileMediaStore(),
  responseStore = new LocalResponseStore(),
  surveyPublisher,
  surveyDefinitionStore = new SurveyDefinitionStore(),
  personaService,
  populationReportService,
  captureSessionService = createCaptureSessionService(),
  captureAnalysisService,
  narrativeArcService,
  voiceAnalysisService,
  gameInsightService,
  overlayContentService,
  llmClient,
  companionInfo = () => companionStatus(readCompanionConfig()),
  frontendDirectory = path.resolve(__dirname, '../frontend/dist'),
  serveFrontend = true,
  aiPlaytestToken = config.aiPlaytest.token,
  aiPlaytestReviewStore = new LocalAiPlaytestReviewStore(),
} = {}) {
  if (serveFrontend) assertFrontendBuild(frontendDirectory);

  const app = express();
  const resolvedPersonaService = personaService || new PersonaService({
    evidenceStores,
    surveyDefinitionStore,
  });
  // One LLM client serves the per-curve evaluation, the narrative-arc
  // commentary, voice extraction and game-insight proposal; services can be injected.
  const resolvedLlmClient = llmClient
    || ((emotionCurveEvaluator && narrativeArcService && gameInsightService && voiceAnalysisService) ? null : createLlmTextClient());
  const resolvedEmotionCurveEvaluator = emotionCurveEvaluator
    || new EmotionCurveEvaluationService({ llmClient: resolvedLlmClient });
  const resolvedNarrativeArcService = narrativeArcService || new NarrativeArcService({
    emotionCurveStore: evidenceStores['emotion-curves'],
    arcStore: new ProfileRecordStore('narrative-arcs'),
    llmClient: resolvedLlmClient,
  });
  const resolvedGameInsightService = gameInsightService || createGameInsightService({
    captureSessionService,
    llmClient: resolvedLlmClient,
  });
  const resolvedOverlayContentService = overlayContentService || new OverlayContentService({
    markdownStore: new OverlayMarkdownStore(),
    captureSessionService,
    gameInsightService: resolvedGameInsightService,
    narrativeArcService: resolvedNarrativeArcService,
  });
  const resolvedSurveyPublisher = surveyPublisher || new GitSurveyPublisher(gitCli);
  const configuredContext = createConfiguredContext({
    configStore,
    gitAuthorReader,
    dataRepositoryVisibilityChecker,
  });
  const resolvedPopulationReportService = populationReportService
    || new LocalPopulationReportService({
      personaService: resolvedPersonaService,
      secret: config.pseudoIdSecret,
    });
  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));
  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'voluptas', mode: 'local' });
  });
  app.get('/api/runtime', (_req, res) => {
    res.json({ ok: true, data: { mode: 'local', authentication: 'none' } });
  });
  app.use('/api/local/capture-sessions', createCaptureSessionRoutes({
    captureSessionService,
    captureAnalysisService: captureAnalysisService
      || createCaptureAnalysisService(captureSessionService),
    emotionCurveStore: evidenceStores['emotion-curves'],
    configuredContext,
    companionInfo,
  }));
  app.use('/api/local/narrative-arcs', createNarrativeArcRoutes({
    narrativeArcService: resolvedNarrativeArcService,
    configuredContext,
  }));
  app.use('/api/local/game-insights', createGameInsightRoutes({
    gameInsightService: resolvedGameInsightService,
    configuredContext,
  }));
  app.use('/api/local/overlay', createOverlayRoutes({
    overlayContentService: resolvedOverlayContentService,
    configuredContext,
  }));
  app.use('/api/local/voice-analysis', createLocalVoiceAnalysisRoutes({
    service: voiceAnalysisService || new VoiceAnalysisService({ llmClient: resolvedLlmClient }),
    configuredContext,
    voiceStore: evidenceStores.voices,
    analysisStore: new ProfileRecordStore('voice-analyses'),
  }));
  // AI プレイテスト感想 (Ingenium)。データリポジトリの ai-playtests/ に置き、回答者名のフォルダには入れない。
  // 書き込みは専用の固定トークンだけ (ローカルに Cernere は無い)、読み出しは他のローカル API と同じく無認証。
  const aiPlaytestReviewService = createAiPlaytestReviewService({ store: aiPlaytestReviewStore });
  app.use('/api/ai-playtests/reviews', createAiPlaytestReviewRouter({
    serviceProvider: () => aiPlaytestReviewService,
    writeAuth: createAiPlaytestAuth({ expectedToken: aiPlaytestToken, serviceTokens: false }),
    resolveContext: async () => ({ repositoryRoot: storeContext(await configuredContext()).repositoryRoot }),
  }));
  app.use('/api/local', createLocalRoutes({
    configStore,
    gitCli,
    gitAuthorReader,
    dataRepositoryVisibilityChecker,
    emotionCurveEvaluator: resolvedEmotionCurveEvaluator,
    evidenceStores,
    mediaStore,
    personaService: resolvedPersonaService,
    populationReportService: resolvedPopulationReportService,
    responseStore,
    surveyPublisher: resolvedSurveyPublisher,
    surveyDefinitionStore,
  }));

  if (serveFrontend) {
    mountFrontend(app, frontendDirectory);
  }

  app.use((_req, res) => {
    res.status(404).json({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Endpoint not found' },
    });
  });
  app.use(errorHandler);
  return app;
}

function readPort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be set to a valid TCP port by Excubitor');
  }
  return port;
}

if (require.main === module) {
  try {
    const port = readPort(process.env.PORT);
    // The main app stays loopback-only; iPhone companions connect to the
    // separate opt-in listener below, which exposes only the token-guarded
    // capture endpoints (spec/feature/emotion-capture-companion.md).
    const companionConfig = readCompanionConfig();
    const captureSessionService = createCaptureSessionService();
    createLocalApp({
      captureSessionService,
      companionInfo: () => companionStatus(companionConfig),
    }).listen(port, '127.0.0.1');
    if (companionConfig) {
      startCompanionListener(createCompanionApp({ captureSessionService }), companionConfig);
    }
  } catch (error) {
    process.stderr.write(`Voluptas local startup failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { createCaptureSessionService, createLocalApp, readPort };
