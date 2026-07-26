const express = require('express');
const helmet = require('helmet');
const fs = require('node:fs');
const path = require('node:path');
const { LocalConfigStore } = require('./local/localConfigStore');
const { GitCli } = require('./local/gitCli');
const { GitAuthorReader } = require('./local/gitAuthorReader');
const { LocalResponseStore } = require('./local/localResponseStore');
const { SurveyDefinitionStore } = require('./local/surveyDefinitionStore');
const { createLocalRoutes } = require('./local/localRoutes');
const { errorHandler } = require('./middleware/errorHandler');

function createLocalApp({
  configStore = new LocalConfigStore(),
  gitCli = new GitCli(),
  gitAuthorReader = new GitAuthorReader(),
  responseStore = new LocalResponseStore(),
  surveyDefinitionStore = new SurveyDefinitionStore(),
  frontendDirectory = path.resolve(__dirname, '../frontend/dist'),
  serveFrontend = true,
} = {}) {
  if (serveFrontend && !fs.existsSync(path.join(frontendDirectory, 'index.html'))) {
    throw Object.assign(new Error('Frontend build is missing; run the local start script through npm'), {
      code: 'FRONTEND_BUILD_MISSING',
    });
  }

  const app = express();
  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));
  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'volputas', mode: 'local' });
  });
  app.use('/api/local', createLocalRoutes({
    configStore,
    gitCli,
    gitAuthorReader,
    responseStore,
    surveyDefinitionStore,
  }));

  if (serveFrontend) {
    app.use(express.static(frontendDirectory));
    app.get('*', (_req, res) => res.sendFile(path.join(frontendDirectory, 'index.html')));
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
