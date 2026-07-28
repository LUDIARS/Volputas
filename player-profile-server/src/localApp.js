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
const { ProfileRecordStore } = require('./local/profileRecordStore');
const { errorHandler } = require('./middleware/errorHandler');

function createLocalApp({
  configStore = new LocalConfigStore(),
  gitCli = new GitCli(),
  gitAuthorReader = new GitAuthorReader(),
  emotionCurveEvaluator,
  comparisonStore = new ProfileRecordStore('comparisons'),
  emotionCurveStore = new ProfileRecordStore('emotion-curves'),
  gameplayStore = new ProfileRecordStore('gameplay'),
  mediaStore = new ProfileMediaStore(),
  responseStore = new LocalResponseStore(),
  surveyPublisher,
  surveyDefinitionStore = new SurveyDefinitionStore(),
  voiceStore = new ProfileRecordStore('voices'),
  personaService,
  frontendDirectory = path.resolve(__dirname, '../frontend/dist'),
  serveFrontend = true,
} = {}) {
  if (serveFrontend) assertFrontendBuild(frontendDirectory);

  const app = express();
  const resolvedPersonaService = personaService || new PersonaService({
    emotionCurveStore,
    gameplayStore,
    voiceStore,
    surveyDefinitionStore,
  });
  const resolvedEmotionCurveEvaluator = emotionCurveEvaluator
    || new EmotionCurveEvaluationService({ llmClient: createLlmTextClient() });
  const resolvedSurveyPublisher = surveyPublisher || new GitSurveyPublisher(gitCli);
  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));
  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'volputas', mode: 'local' });
  });
  app.get('/api/runtime', (_req, res) => {
    res.json({ ok: true, data: { mode: 'local', authentication: 'none' } });
  });
  app.use('/api/local', createLocalRoutes({
    configStore,
    gitCli,
    gitAuthorReader,
    emotionCurveEvaluator: resolvedEmotionCurveEvaluator,
    emotionCurveStore,
    gameplayStore,
    mediaStore,
    personaService: resolvedPersonaService,
    responseStore,
    surveyPublisher: resolvedSurveyPublisher,
    surveyDefinitionStore,
    voiceStore,
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
    createLocalApp().listen(port, '127.0.0.1');
  } catch (error) {
    process.stderr.write(`Volputas local startup failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { createLocalApp, readPort };
