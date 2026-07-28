const fs = require('node:fs/promises');
const { Router } = require('express');
const { AppError } = require('../middleware/errorHandler');
const {
  validateDataRepositoryPath,
  validateLocalConfig,
} = require('./localConfigStore');
const { listSurveysWithResponseStatus } = require('./surveyResponseStatus');
const { EXPERIENCE_CARDS } = require('../services/personaEvidence/experienceCards');
const {
  validateCardSortInput,
  validateComparisonInput,
  validateEmotionCurveInput,
  validateGameplayInput,
  validateVoiceInput,
} = require('../services/profileEvidenceSchemas');

function asAppError(error, statusCode = 400) {
  if (error instanceof AppError) return error;
  return new AppError(
    error.statusCode || statusCode,
    error.code || 'LOCAL_OPERATION_FAILED',
    error.message
  );
}

function createLocalRoutes({
  cardSortStore,
  comparisonStore,
  configStore,
  gitCli,
  gitAuthorReader,
  emotionCurveEvaluator,
  emotionCurveStore,
  gameplayStore,
  mediaStore,
  personaService,
  responseStore,
  surveyPublisher,
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
      // アンケート定義の正本はデータリポジトリ (VolputasData) 側にある。設定を保存する前に
      // 実際に読めることを確認し、定義が1本も無いディレクトリを「設定済み」として
      // 受け入れない。ここで既定のアンケートを書き出すと正本がコード側とリポジトリ側の
      // 2箇所になり、リポジトリを更新しても古い定義が残り続ける。
      const surveys = await surveyDefinitionStore.list(gitAuthor.repositoryRoot);
      const config = await configStore.write(candidate);
      return res.json({
        ok: true,
        data: {
          configured: true,
          config,
          gitAuthor,
          surveys: { count: surveys.length, ids: surveys.map((survey) => survey.id) },
        },
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
      const gitSync = await surveyPublisher.publish({
        repositoryRoot: gitAuthor.repositoryRoot,
        responseFilePath: result.filePath,
        surveyId: survey.id,
      });
      return res.json({ ok: true, data: { ...result, gitSync } });
    } catch (error) {
      return next(asAppError(error));
    }
  });

  collectionRoutes('/gameplay', gameplayStore, validateGameplayInput);
  collectionRoutes('/voices', voiceStore, validateVoiceInput);
  collectionRoutes('/emotion-curves', emotionCurveStore, validateEmotionCurveInput);
  collectionRoutes('/comparisons', comparisonStore, validateComparisonInput);
  collectionRoutes('/card-sorts', cardSortStore, validateCardSortInput);

  router.get('/comparisons/deck', (_req, res) => {
    res.json({ ok: true, data: EXPERIENCE_CARDS.map(({ id, text }) => ({ id, text })) });
  });

  async function readGameLogText(context, recordId) {
    const media = await mediaStore.resolve({ ...context, kind: 'gamelogs', recordId });
    if (!media) return null;
    return fs.readFile(media.filePath, 'utf8');
  }

  router.post('/emotion-curves/:recordId/evaluate', async (req, res, next) => {
    try {
      const { config, gitAuthor } = await configuredContext();
      const context = { repositoryRoot: gitAuthor.repositoryRoot, name: config.name };
      const records = await emotionCurveStore.list(context);
      const record = records.find((item) => item.id === req.params.recordId);
      if (!record) throw new AppError(404, 'PROFILE_RECORD_NOT_FOUND', 'Emotion curve not found');
      const { analysis } = await personaService.status(context);
      const evaluation = await emotionCurveEvaluator.evaluate({
        record,
        persona: analysis,
        gameLogText: await readGameLogText(context, record.id),
      });
      const result = await emotionCurveStore.write({
        ...context,
        data: { ...record, evaluation },
      });
      return res.json({ ok: true, data: result.record });
    } catch (error) {
      return next(asAppError(error, error.statusCode || 502));
    }
  });

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

  router.get('/persona/history', async (_req, res, next) => {
    try {
      const { config, gitAuthor } = await configuredContext();
      return res.json({
        ok: true,
        data: await personaService.historySeries({
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
