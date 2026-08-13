// Loopback (desktop UI / game) routes for capture sessions. The LAN-facing
// companion endpoints live in companionApp.js; this router is only mounted on
// the 127.0.0.1 local app.
const { Router } = require('express');
const { asAppError } = require('./localRoutes');
const { profileRecord, storeContext } = require('./localContext');
const {
  validateMarkerInput,
  validateSignalInput,
  validateStartInput,
} = require('../services/captureSession/captureSessionSchemas');
const { buildEmotionCurveDraft } = require('../services/captureAnalysis/emotionCurveDraft');
const { validateEmotionCurveInput } = require('../services/profileEvidenceSchemas');

/** @implements SPEC-EMOTION-CAPTURE-COMPANION */
function createCaptureSessionRoutes({
  captureSessionService,
  captureAnalysisService,
  emotionCurveStore,
  configuredContext,
  companionInfo,
}) {
  const router = Router();

  function requireJson(req, _res, next) {
    if (req.is('application/json')) return next();
    return next(asAppError(Object.assign(new Error('Content-Type must be application/json'), {
      code: 'JSON_CONTENT_TYPE_REQUIRED',
    }), 415));
  }

  function handle(handler) {
    return async (req, res, next) => {
      try {
        await handler(req, res);
      } catch (error) {
        const defaultStatus = error.code === 'INVALID_CAPTURE_INPUT' ? 400 : 500;
        next(asAppError(error, error.statusCode || defaultStatus));
      }
    };
  }

  router.get('/companion/status', handle(async (_req, res) => {
    res.json({ ok: true, data: companionInfo() });
  }));

  router.get('/analysis/status', handle(async (_req, res) => {
    res.json({ ok: true, data: captureAnalysisService.status() });
  }));

  router.get('/active', handle(async (_req, res) => {
    const context = storeContext(await configuredContext());
    res.json({ ok: true, data: await captureSessionService.active(context) });
  }));

  router.post('/active/markers', requireJson, handle(async (req, res) => {
    const context = storeContext(await configuredContext());
    await captureSessionService.initialize(context);
    const record = await captureSessionService.addMarker('desktop', validateMarkerInput(req.body));
    res.status(201).json({ ok: true, data: record });
  }));

  router.post('/active/stop', requireJson, handle(async (req, res) => {
    const context = storeContext(await configuredContext());
    await captureSessionService.initialize(context);
    res.json({ ok: true, data: await captureSessionService.stop(req.body || {}) });
  }));

  router.post('/active/pairing', requireJson, handle(async (_req, res) => {
    const context = storeContext(await configuredContext());
    await captureSessionService.initialize(context);
    res.status(201).json({ ok: true, data: await captureSessionService.issuePairing() });
  }));

  router.post('/signal', requireJson, handle(async (req, res) => {
    const context = storeContext(await configuredContext());
    const input = validateSignalInput(req.body);
    const record = await captureSessionService.handleSignal(context, input);
    res.status(input.action === 'start' ? 201 : 200).json({ ok: true, data: record });
  }));

  router.get('/', handle(async (_req, res) => {
    const context = storeContext(await configuredContext());
    res.json({ ok: true, data: await captureSessionService.list(context) });
  }));

  router.post('/', requireJson, handle(async (req, res) => {
    const context = storeContext(await configuredContext());
    const record = await captureSessionService.start(
      context,
      validateStartInput(req.body),
      'manual'
    );
    res.status(201).json({ ok: true, data: record });
  }));

  // ローカル単独の感情分析: 音声 → whisper-stt → sentiment-core。結果はセッション
  // レコードの analysis に保存され、再実行で上書きされる。
  router.post('/:id/analyze', handle(async (req, res) => {
    const context = storeContext(await configuredContext());
    const record = await captureAnalysisService.analyze(context, req.params.id);
    res.json({ ok: true, data: record });
  }));

  // 分析済みキャプチャから感情曲線レコード (mode: capture) を起こす。既存の
  // validate + respondent 付与を通すので、手書きの曲線と同じ経路で persona に載る。
  router.post('/:id/emotion-curve', handle(async (req, res) => {
    const { config, gitAuthor } = await configuredContext();
    const context = storeContext({ config, gitAuthor });
    const record = await captureSessionService.findRecord(context, req.params.id);
    const draft = buildEmotionCurveDraft({ record, analysis: record.analysis });
    const result = await emotionCurveStore.write({
      ...context,
      data: profileRecord(validateEmotionCurveInput(draft), config, gitAuthor),
    });
    res.status(201).json({ ok: true, data: result.record });
  }));

  router.get('/:id/timeline', handle(async (req, res) => {
    const context = storeContext(await configuredContext());
    res.json({ ok: true, data: await captureSessionService.timeline(context, req.params.id) });
  }));

  router.get('/:id/audio', handle(async (req, res) => {
    const context = storeContext(await configuredContext());
    const media = await captureSessionService.resolveAudio(context, req.params.id);
    if (!media) {
      throw Object.assign(new Error('Session audio not found'), {
        statusCode: 404,
        code: 'MEDIA_NOT_FOUND',
      });
    }
    res.type(media.contentType);
    res.sendFile(media.filePath);
  }));

  return router;
}

module.exports = { createCaptureSessionRoutes };
