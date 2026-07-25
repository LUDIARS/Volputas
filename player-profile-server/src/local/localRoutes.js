const { Router } = require('express');
const { AppError } = require('../middleware/errorHandler');
const { validateLocalConfig } = require('./localConfigStore');
const { listSurveysWithResponseStatus } = require('./surveyResponseStatus');

function asAppError(error, statusCode = 400) {
  if (error instanceof AppError) return error;
  return new AppError(statusCode, error.code || 'LOCAL_OPERATION_FAILED', error.message);
}

function createLocalRoutes({
  configStore,
  gitAuthorReader,
  responseStore,
  surveyDefinitionStore,
}) {
  const router = Router();

  async function configuredContext() {
    const config = await configStore.read();
    if (!config) {
      throw new AppError(
        409,
        'LOCAL_CONFIG_REQUIRED',
        'Set the data repository and GitHub name in Settings first'
      );
    }
    const gitAuthor = await gitAuthorReader.read(config.dataRepositoryPath);
    return { config, gitAuthor };
  }

  router.get('/config', async (_req, res, next) => {
    try {
      const config = await configStore.read();
      if (!config) {
        return res.json({ ok: true, data: { configured: false, config: null, gitAuthor: null } });
      }

      try {
        const gitAuthor = await gitAuthorReader.read(config.dataRepositoryPath);
        return res.json({ ok: true, data: { configured: true, config, gitAuthor } });
      } catch (error) {
        return res.json({
          ok: true,
          data: {
            configured: true,
            config,
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
      const candidate = validateLocalConfig({
        dataRepositoryPath: req.body?.dataRepositoryPath,
        githubName: req.body?.githubName,
      });
      const gitAuthor = await gitAuthorReader.read(candidate.dataRepositoryPath);
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
          githubName: config.githubName,
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
        githubName: config.githubName,
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
        githubName: config.githubName,
        author: gitAuthor,
        survey,
        answers: req.body?.answers,
      });
      return res.json({ ok: true, data: result });
    } catch (error) {
      return next(asAppError(error));
    }
  });

  return router;
}

module.exports = { asAppError, createLocalRoutes };
