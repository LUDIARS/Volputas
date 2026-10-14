const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const { createCernereProjectAuth } = require('../middleware/cernereProjectAuth');
const { AppError, asInputError } = require('../middleware/errorHandler');
const { createVoiceAnalysisRoutes } = require('./voiceAnalysisRoutes');

const RATE_LIMIT_MESSAGE = {
  ok: false,
  error: { code: 'RATE_LIMIT', message: 'Too many requests' },
};

function positiveInteger(value, fallback, maximum, minimum = 0) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) return null;
  return parsed;
}

/** @implements SPEC-GLAB-REVIEW-RELAY */
function createGlabReviewRouter({
  authMiddleware = createCernereProjectAuth(),
  transportRateLimiter = rateLimit({
    windowMs: config.rateLimit.general.windowMs,
    max: config.rateLimit.general.max * 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: RATE_LIMIT_MESSAGE,
  }),
  userRateLimiter = rateLimit({
    windowMs: config.rateLimit.general.windowMs,
    max: config.rateLimit.general.max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.cernereUser.id,
    message: RATE_LIMIT_MESSAGE,
  }),
  serviceProvider,
  recentGamesProvider = null,
  analysisService = null,
} = {}) {
  const router = Router();
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    next();
  });
  if (transportRateLimiter) router.use(transportRateLimiter);
  router.use(authMiddleware);
  router.use(userRateLimiter);

  router.get('/', async (req, res, next) => {
    // limit starts at 1: a zero limit is ambiguous downstream, where some
    // backends read it as "no limit".
    const limit = positiveInteger(req.query.limit, 50, 50, 1);
    const offset = positiveInteger(req.query.offset, 0, Number.MAX_SAFE_INTEGER);
    if (limit === null || offset === null) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'INVALID_PROFILE_INPUT',
          message: 'limit must be 1-50 and offset must be a non-negative integer',
        },
      });
    }
    try {
      return res.json({ ok: true, data: await serviceProvider().list({
        glabProjectId: typeof req.query.projectId === 'string' ? req.query.projectId : null,
        limit,
        offset,
      }) });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const record = await serviceProvider().create(req.cernereUser.id, req.body);
      // The 201 record is what GLAB (the front) uses to queue its own Discord
      // relay, so it must keep visibility / anonymous / glabProjectId / gameTitle /
      // recommend / comment (see GLAB spec/interface/review-relay.md).
      return res.status(201).json({ ok: true, data: { record } });
    } catch (error) {
      return next(asInputError(error));
    }
  });

  // 追加ヒアリング: 感想の不足情報を一問ずつ聞く (Voluptas 本体の声と同じ質問・同じ保存形)。
  // 記録は GLAB 経路の owner id (req.cernereUser.id) で本人のものだけを引く。
  // @implements SPEC-GLAB-VOICE-FOLLOW-UP
  router.get('/:recordId/follow-up', async (req, res, next) => {
    try {
      return res.json({ ok: true, data: await serviceProvider().followUp(req.cernereUser.id, req.params.recordId) });
    } catch (error) {
      return next(ownedVoiceError(error));
    }
  });

  router.post('/:recordId/follow-up', async (req, res, next) => {
    try {
      return res.json({
        ok: true,
        data: await serviceProvider().answerFollowUp(req.cernereUser.id, req.params.recordId, req.body),
      });
    } catch (error) {
      if (error.code === 'FOLLOW_UP_NOT_OPEN') return next(new AppError(409, error.code, error.message));
      return next(ownedVoiceError(error));
    }
  });

  // 体験解析: 本人の明示操作 (consent: true) でだけ LLM に送る。読み書きは本人の記録に閉じる。
  if (analysisService) {
    router.use('/analysis', createVoiceAnalysisRoutes({
      service: analysisService,
      async load(req) {
        const record = await serviceProvider().loadVoice(req.cernereUser.id, req.params.recordId)
          .catch((error) => { throw ownedVoiceError(error); });
        return {
          record,
          analysis: record.experienceAnalysis ?? null,
          requestKey: JSON.stringify(['glab', req.cernereUser.id, record.id]),
        };
      },
      async save(req, { record }, analysis) {
        await serviceProvider().saveAnalysis(req.cernereUser.id, record.id, analysis)
          .catch((error) => { throw ownedVoiceError(error); });
      },
    }));
  }

  router.get('/recent-games', async (req, res, next) => {
    try {
      const games = recentGamesProvider
        ? await recentGamesProvider(req.cernereUser.id)
        : [];
      return res.json({
        ok: true,
        data: games.slice(0, 20).map((game) => ({
          name: game.name,
          playtimeTwoWeeksMinutes: game.playtime_2weeks_minutes,
        })),
      });
    } catch (error) {
      return next(error);
    }
  });
  return router;
}

function ownedVoiceError(error) {
  if (error instanceof AppError) return error;
  if (error?.statusCode === 404) return new AppError(404, 'PROFILE_RECORD_NOT_FOUND', 'Voice not found');
  return asInputError(error);
}

module.exports = { createGlabReviewRouter, positiveInteger };
