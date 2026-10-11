const { Router } = require('express');
const { AppError } = require('../middleware/errorHandler');
const { CATALOG } = require('../services/voiceAnalysis/catalog');
const { sourceRevision } = require('../services/voiceAnalysis/source');

// Mounted only inside the existing authenticated or configured local routes.
// load() scopes every read to the caller; save() never accepts input identity.
/** @implements SPEC-VOICE-EXPERIENCE-ANALYSIS */
function createVoiceAnalysisRoutes({ service, load, save }) {
  const router = Router();
  const pendingSaves = new Set();
  router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
  const handle = (handler) => async (req, res, next) => {
    try { await handler(req, res); } catch (error) {
      next(error instanceof AppError ? error : new AppError(
        error.statusCode || 500, error.code || 'VOICE_ANALYSIS_FAILED',
        error.statusCode ? error.message : '声の解析結果を読み書きできませんでした。',
      ));
    }
  };
  router.get('/catalog', (_req, res) => res.json({ ok: true, data: CATALOG }));
  router.get('/:recordId', handle(async (req, res) => {
    const { record, analysis } = await load(req);
    res.json({ ok: true, data: service.status(record, analysis) });
  }));
  router.post('/:recordId', handle(async (req, res) => {
    if (!req.is('application/json') || req.body?.consent !== true) {
      throw new AppError(400, 'VOICE_ANALYSIS_CONSENT_REQUIRED', '感想をAIに送って解析することを確認してください。');
    }
    const original = await load(req);
    if (pendingSaves.has(original.requestKey)) {
      throw new AppError(409, 'VOICE_ANALYSIS_BUSY', 'この声は解析・保存中です。完了後に結果を確認してください。');
    }
    pendingSaves.add(original.requestKey);
    try {
      const analysis = await service.analyze(original.record, original.analysis, original.requestKey);
      const latest = await load(req);
      if (latest.requestKey !== original.requestKey || sourceRevision(latest.record) !== analysis.sourceRevision) {
        throw new AppError(409, 'VOICE_ANALYSIS_STALE', '解析中に感想が更新されました。再度解析してください。');
      }
      if (analysis !== original.analysis) await save(req, latest, analysis);
      // Concurrent edits can leave a stale derived record, never a current response.
      const final = await load(req);
      if (final.requestKey !== original.requestKey) {
        throw new AppError(409, 'VOICE_ANALYSIS_CONTEXT_CHANGED', '保存先が変更されました。結果を開き直してください。');
      }
      res.json({ ok: true, data: service.status(final.record, final.analysis) });
    } finally {
      pendingSaves.delete(original.requestKey);
    }
  }));
  return router;
}

module.exports = { createVoiceAnalysisRoutes };
