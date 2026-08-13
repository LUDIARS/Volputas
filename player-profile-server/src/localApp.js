const express = require('express');
const helmet = require('helmet');
const path = require('node:path');
const { LocalConfigStore } = require('./local/localConfigStore');
const { GitCli } = require('./local/gitCli');
const { GitAuthorReader } = require('./local/gitAuthorReader');
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
const { createConfiguredContext } = require('./local/localContext');
const { createCaptureSessionRoutes } = require('./local/captureSessionRoutes');
const {
  createCaptureAnalysisService,
  createCaptureSessionService,
} = require('./local/captureSessionComposition');
const { createCompanionApp } = require('./local/companionApp');
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
  companionInfo = () => companionStatus(readCompanionConfig()),
  frontendDirectory = path.resolve(__dirname, '../frontend/dist'),
  serveFrontend = true,
} = {}) {
  if (serveFrontend) assertFrontendBuild(frontendDirectory);

  const app = express();
  const resolvedPersonaService = personaService || new PersonaService({
    evidenceStores,
    surveyDefinitionStore,
  });
  const resolvedEmotionCurveEvaluator = emotionCurveEvaluator
    || new EmotionCurveEvaluationService({ llmClient: createLlmTextClient() });
  const resolvedSurveyPublisher = surveyPublisher || new GitSurveyPublisher(gitCli);
  const resolvedPopulationReportService = populationReportService
    || new LocalPopulationReportService({
      personaService: resolvedPersonaService,
      secret: config.pseudoIdSecret,
    });
  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));
  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'volputas', mode: 'local' });
  });
  app.get('/api/runtime', (_req, res) => {
    res.json({ ok: true, data: { mode: 'local', authentication: 'none' } });
  });
  app.use('/api/local/capture-sessions', createCaptureSessionRoutes({
    captureSessionService,
    captureAnalysisService: captureAnalysisService
      || createCaptureAnalysisService(captureSessionService),
    emotionCurveStore: evidenceStores['emotion-curves'],
    configuredContext: createConfiguredContext({ configStore, gitAuthorReader }),
    companionInfo,
  }));
  app.use('/api/local', createLocalRoutes({
    configStore,
    gitCli,
    gitAuthorReader,
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
    process.stderr.write(`Volputas local startup failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { createCaptureSessionService, createLocalApp, readPort };
