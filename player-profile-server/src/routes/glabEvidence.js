const express = require('express');
const { Router } = require('express');
const { AppError, asInputError } = require('../middleware/errorHandler');
const { createCernereProjectAuth } = require('../middleware/cernereProjectAuth');
const {
  OWNER_SUBJECT,
  verifyMediaTicket,
} = require('../services/mediaTicketService');
const {
  createCorpusTransportRateLimiter,
  createCorpusUserRateLimiter,
} = require('./corpusRateLimits');

const TICKET_ERROR_NAMES = new Set(['TokenExpiredError', 'JsonWebTokenError']);
const INPUT_ERROR_CODES = new Set([
  'INVALID_PROFILE_INPUT',
  'INVALID_PROFILE_PATH',
  'MEDIA_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
]);

function isTicketError(error) {
  return error?.code === 'INVALID_MEDIA_TICKET' || TICKET_ERROR_NAMES.has(error?.name);
}

function asEvidenceRequestError(error) {
  return INPUT_ERROR_CODES.has(error?.code) ? asInputError(error) : error;
}

/**
 * GLAB から感情曲線を扱う口。
 *
 * 記録の作成 → 動画/ゲームログのアップロード → LLM 評価 → 再生、 の 4 手を
 * Cernere project token だけで通す。 動画の再生だけは <video> から直接引かれる
 * ため、 Authorization ヘッダを付けられない。 そこは既存の自前フロントと同じで、
 * 短命の署名付きチケットを別に発行して認可する。
 *
 * @implements SPEC-GLAB-EVIDENCE-MEDIA-TRANSPORT
 */
function createGlabEvidenceRouter({
  authMiddleware = createCernereProjectAuth(),
  transportRateLimiter = createCorpusTransportRateLimiter(),
  userRateLimiter = createCorpusUserRateLimiter(),
  serviceProvider,
  verifyTicket = verifyMediaTicket,
  // 本文パーサはこのルータの中に置く。 このルータ自体は express.json より前に
  // 載る必要があり (動画をストリームで受けるため)、 JSON の口だけが個別に
  // パーサを通る形にしないと両立しない。
  parseJson = express.json({ limit: '1mb' }),
} = {}) {
  if (!serviceProvider) throw new TypeError('serviceProvider is required');
  const router = Router();

  router.use((_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    next();
  });
  // このルータは全体の general limiter より前に載る。 チケット再生口も含めて
  // transport 境界を先に置かないと、 署名検証とファイル配信だけが無制限になる。
  if (transportRateLimiter) router.use(transportRateLimiter);

  // 再生はチケット認可なので、 project token を要求する前に受ける。
  router.get('/media/:kind/:recordId', async (req, res, next) => {
    try {
      const ticket = await verifyTicket(req.query.ticket, { subjectType: OWNER_SUBJECT });
      if (ticket.kind !== req.params.kind || ticket.recordId !== req.params.recordId) {
        throw new AppError(403, 'MEDIA_TICKET_MISMATCH', 'Media ticket does not match this file');
      }
      const media = await serviceProvider().resolveMedia(ticket.sub, {
        kind: req.params.kind,
        recordId: req.params.recordId,
      });
      res.type(media.contentType);
      return res.sendFile(media.filePath);
    } catch (error) {
      if (isTicketError(error)) {
        return next(new AppError(401, 'INVALID_MEDIA_TICKET', 'Media ticket is invalid or expired'));
      }
      return next(error);
    }
  });

  router.use(authMiddleware);
  router.use(userRateLimiter);

  router.get('/emotion-curves', async (req, res, next) => {
    try {
      const records = await serviceProvider().listEmotionCurves(req.cernereUser.id);
      return res.json({ ok: true, data: records });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/emotion-curves', parseJson, async (req, res, next) => {
    try {
      const record = await serviceProvider().createEmotionCurve(req.cernereUser.id, req.body);
      return res.status(201).json({ ok: true, data: { record } });
    } catch (error) {
      return next(asEvidenceRequestError(error));
    }
  });

  router.post('/emotion-curves/:recordId/evaluate', async (req, res, next) => {
    try {
      const record = await serviceProvider().evaluateEmotionCurve(
        req.cernereUser.id,
        req.params.recordId,
      );
      return res.json({ ok: true, data: { record } });
    } catch (error) {
      if (error instanceof AppError) return next(error);
      // 評価は外部 LLM 呼び出しなので、 失敗は入力不正ではなく上流障害として扱う。
      return next(new AppError(
        502,
        'EVALUATION_FAILED',
        'Emotion curve evaluation failed',
      ));
    }
  });

  router.put('/media/:kind/:recordId', async (req, res, next) => {
    try {
      const result = await serviceProvider().saveMedia(req.cernereUser.id, {
        kind: req.params.kind,
        recordId: req.params.recordId,
        contentType: String(req.headers['content-type'] || '').split(';')[0].trim(),
        stream: req,
      });
      return res.status(201).json({ ok: true, data: result });
    } catch (error) {
      return next(asEvidenceRequestError(error));
    }
  });

  router.get('/media/:kind/:recordId/ticket', async (req, res, next) => {
    try {
      const ticket = await serviceProvider().issueMediaTicket(req.cernereUser.id, {
        kind: req.params.kind,
        recordId: req.params.recordId,
      });
      return res.json({
        ok: true,
        data: {
          url: `/api/v1/integrations/glab/evidence/media/${req.params.kind}`
            + `/${req.params.recordId}?ticket=${encodeURIComponent(ticket)}`,
        },
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createGlabEvidenceRouter };
