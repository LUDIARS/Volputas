const { Router } = require('express');
const { AppError } = require('../middleware/errorHandler');
const {
  validateDataRepositoryPath,
  validateLocalConfig,
} = require('./localConfigStore');
const { listSurveysWithResponseStatus } = require('./surveyResponseStatus');
const {
  validateEmotionCurveInput,
  validateGameplayInput,
  validateVoiceInput,
} = require('./profileInputSchemas');

function asAppError(error, statusCode = 400) {
  if (error instanceof AppError) return error;
  return new AppError(statusCode, error.code || 'LOCAL_OPERATION_FAILED', error.message);
}

function createLocalRoutes({
  configStore,
  gitCli,
  gitAuthorReader,
  emotionCurveStore,
  gameplayStore,
  mediaStore,
  personaService,
  responseStore,
  surveyDefinitionStore,
  voiceStore,
}) {
  const router = Router();

  router.get('/environment', async (_req, res, next) => {
    try {
      return res.json({
        ok: true,
        data: { git: await gitCli.inspect() },
      });
    } catch (error) {
      return next(asAppError(error));
    }
  });

  async function configuredContext() {
    const storedConfig = await configStore.read();
    if (!storedConfig) {
      throw new AppError(
        409,
        'LOCAL_CONFIG_REQUIRED',
        'Set the data repository and GitHub name in Settings first'
      );
    }
    const gitAuthor = await gitAuthorReader.read(storedConfig.dataRepositoryPath);
    const config = storedConfig.name === gitAuthor.name
      ? storedConfig
      : await configStore.write({ ...storedConfig, name: gitAuthor.name });
    return { config, gitAuthor };
  }

  function profileRecord(input, config, gitAuthor) {
    return {
      ...input,
      respondent: {
        name: config.name,
        gitAuthor: {
          name: gitAuthor.name,
          email: gitAuthor.email,
        },
      },
      dataRepository: { remoteUrl: gitAuthor.remoteUrl },
    };
  }

  function collectionRoutes(routePath, store, validate) {
    router.get(routePath, async (_req, res, next) => {
      try {
        const { config, gitAuthor } = await configuredContext();
        return res.json({
          ok: true,
          data: await store.list({
            repositoryRoot: gitAuthor.repositoryRoot,
            name: config.name,
          }),
        });
      } catch (error) {
        return next(asAppError(error));
      }
    });

    router.post(routePath, async (req, res, next) => {
      try {
        const { config, gitAuthor } = await configuredContext();
        const result = await store.write({
          repositoryRoot: gitAuthor.repositoryRoot,
          name: config.name,
          data: profileRecord(validate(req.body), config, gitAuthor),
        });
        return res.status(201).json({ ok: true, data: result });
      } catch (error) {
        return next(asAppError(error));
      }
    });
  }

  router.get('/config', async (_req, res, next) => {
    try {
      const storedConfig = await configStore.read();
      if (!storedConfig) {
        return res.json({ ok: true, data: { configured: false, config: null, gitAuthor: null } });
      }

      try {
        const gitAuthor = await gitAuthorReader.read(storedConfig.dataRepositoryPath);
        const config = storedConfig.name === gitAuthor.name
          ? storedConfig
          : await configStore.write({ ...storedConfig, name: gitAuthor.name });
        return res.json({ ok: true, data: { configured: true, config, gitAuthor } });
      } catch (error) {
        return res.json({
          ok: true,
          data: {
            configured: true,
            config: storedConfig,
            gitAuthor: null,
            configurationError: error.message,
          },
        });
      }
    } catch (error) {
      return next(asAppError(error));
    }
  });

  router.put('/config', async (req, res, next) => {
    try {
      await gitCli.assertAvailable();
      const dataRepositoryPath = validateDataRepositoryPath(req.body?.dataRepositoryPath);
      const gitAuthor = await gitAuthorReader.read(dataRepositoryPath);
      const candidate = validateLocalConfig({
        dataRepositoryPath,
        name: gitAuthor.name,
      });
      const surveyData = await surveyDefinitionStore.ensureDefault(gitAuthor.repositoryRoot);
      const config = await configStore.write(candidate);
      return res.json({
        ok: true,
        data: { configured: true, config, gitAuthor, surveyData },
      });
    } catch (error) {
      return next(asAppError(error));
    }
  });

  router.get('/surveys', async (_req, res, next) => {
    try {
      const { config, gitAuthor } = await configuredContext();
      const surveys = await surveyDefinitionStore.list(gitAuthor.repositoryRoot);
      return res.json({
        ok: true,
        data: await listSurveysWithResponseStatus({
          surveys,
          responseStore,
          repositoryRoot: gitAuthor.repositoryRoot,
          name: config.name,
        }),
      });
    } catch (error) {
      return next(asAppError(error));
    }
  });

  router.get('/surveys/:surveyId/response', async (req, res, next) => {
    try {
      const { config, gitAuthor } = await configuredContext();
      const survey = await surveyDefinitionStore.find(
        gitAuthor.repositoryRoot,
        req.params.surveyId
      );
      if (!survey) throw new AppError(404, 'SURVEY_NOT_FOUND', 'Survey not found');
      const response = await responseStore.read({
        repositoryRoot: gitAuthor.repositoryRoot,
        name: config.name,
        surveyId: survey.id,
      });
      return res.json({ ok: true, data: response });
    } catch (error) {
      return next(asAppError(error));
    }
  });

  router.put('/surveys/:surveyId/response', async (req, res, next) => {
    try {
      const { config, gitAuthor } = await configuredContext();
      const survey = await surveyDefinitionStore.find(
        gitAuthor.repositoryRoot,
        req.params.surveyId
      );
      if (!survey) throw new AppError(404, 'SURVEY_NOT_FOUND', 'Survey not found');
      const result = await responseStore.write({
        repositoryRoot: gitAuthor.repositoryRoot,
        name: config.name,
        author: gitAuthor,
        survey,
        answers: req.body?.answers,
      });
      return res.json({ ok: true, data: result });
    } catch (error) {
      return next(asAppError(error));
    }
  });

  collectionRoutes('/gameplay', gameplayStore, validateGameplayInput);
  collectionRoutes('/voices', voiceStore, validateVoiceInput);
  collectionRoutes('/emotion-curves', emotionCurveStore, validateEmotionCurveInput);

  router.put('/media/:kind/:recordId', async (req, res, next) => {
    try {
      const { config, gitAuthor } = await configuredContext();
      const contentType = String(req.headers['content-type'] || '').split(';')[0].trim();
      const result = await mediaStore.save({
        repositoryRoot: gitAuthor.repositoryRoot,
        name: config.name,
        kind: req.params.kind,
        recordId: req.params.recordId,
        contentType,
        stream: req,
      });
      return res.status(201).json({
        ok: true,
        data: { bytes: result.bytes, contentType: result.contentType },
      });
    } catch (error) {
      return next(asAppError(error));
    }
  });

  router.get('/media/:kind/:recordId', async (req, res, next) => {
    try {
      const { config, gitAuthor } = await configuredContext();
      const media = await mediaStore.resolve({
        repositoryRoot: gitAuthor.repositoryRoot,
        name: config.name,
        kind: req.params.kind,
        recordId: req.params.recordId,
      });
      if (!media) throw new AppError(404, 'MEDIA_NOT_FOUND', 'Media not found');
      res.type(media.contentType);
      return res.sendFile(media.filePath);
    } catch (error) {
      return next(asAppError(error));
    }
  });

  router.get('/persona', async (_req, res, next) => {
    try {
      const { config, gitAuthor } = await configuredContext();
      return res.json({
        ok: true,
        data: await personaService.status({
          repositoryRoot: gitAuthor.repositoryRoot,
          name: config.name,
        }),
      });
    } catch (error) {
      return next(asAppError(error));
    }
  });

  router.post('/persona/analyze', async (_req, res, next) => {
    try {
      const { config, gitAuthor } = await configuredContext();
      return res.json({
        ok: true,
        data: await personaService.analyze({
          repositoryRoot: gitAuthor.repositoryRoot,
          name: config.name,
        }),
      });
    } catch (error) {
      return next(asAppError(error));
    }
  });

  return router;
}

module.exports = { asAppError, createLocalRoutes };
