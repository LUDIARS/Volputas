// Loopback (desktop UI / game) routes for capture sessions. The LAN-facing
// companion endpoints live in companionApp.js; this router is only mounted on
// the 127.0.0.1 local app.
const { Router } = require('express');
const { asAppError } = require('./localRoutes');
const { profileRecord, storeContext } = require('./localContext');
const {
  validateAudioMetaInput,
  validateCalibrationInput,
  validateGazeEstimationMetaInput,
  validateMarkerInput,
  validateSignalInput,
  validateStartInput,
  validateVideoMetaInput,
} = require('../services/captureSession/captureSessionSchemas');
const { assertVideoKind } = require('../services/captureSession/captureVideoStore');
const { parseGazeSampleLines } = require('../services/captureSession/gazeSampleStream');
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

  function rawContentType(req) {
    return String(req.headers['content-type'] || '').split(';')[0].trim();
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
  router.post('/:id/analyze', requireJson, handle(async (req, res) => {
    const context = storeContext(await configuredContext());
    const record = await captureAnalysisService.analyze(context, req.params.id);
    res.json({ ok: true, data: record });
  }));

  // 分析済みキャプチャから感情曲線レコード (mode: capture) を起こす。既存の
  // validate + respondent 付与を通すので、手書きの曲線と同じ経路で persona に載る。
  router.post('/:id/emotion-curve', requireJson, handle(async (req, res) => {
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

  // ---- desktop capture (§デスクトップキャプチャ / §録画): the browser tab that
  // recorded microphone, face camera and screen uploads after stop. Same
  // header contract as the companion audio upload so both paths anchor media
  // on the session clock the same way.

  router.put('/:id/audio', handle(async (req, res) => {
    const context = storeContext(await configuredContext());
    const { durationSeconds, startSessionMs } = validateAudioMetaInput(req.headers);
    const result = await captureSessionService.attachAudioLocal(context, req.params.id, {
      contentType: rawContentType(req),
      stream: req,
      durationSeconds,
      startSessionMs,
    });
    res.status(201).json({ ok: true, data: result });
  }));

  router.put('/:id/recordings/:kind', handle(async (req, res) => {
    const context = storeContext(await configuredContext());
    assertVideoKind(req.params.kind);
    const meta = validateVideoMetaInput(req.headers);
    const result = await captureSessionService.attachVideo(context, req.params.id, {
      kind: req.params.kind,
      contentType: rawContentType(req),
      stream: req,
      ...meta,
    });
    res.status(201).json({ ok: true, data: result });
  }));

  router.get('/:id/recordings/:kind', handle(async (req, res) => {
    const context = storeContext(await configuredContext());
    assertVideoKind(req.params.kind);
    const media = await captureSessionService.resolveVideo(context, req.params.id, req.params.kind);
    if (!media) {
      throw Object.assign(new Error('Recording not found'), {
        statusCode: 404,
        code: 'MEDIA_NOT_FOUND',
      });
    }
    res.type(media.contentType);
    // sendFile honours Range requests, which the replay <video> needs to seek.
    res.sendFile(media.filePath);
  }));

  router.put('/:id/calibration', requireJson, handle(async (req, res) => {
    const context = storeContext(await configuredContext());
    const record = await captureSessionService.saveCalibration(
      context,
      req.params.id,
      validateCalibrationInput(req.body)
    );
    res.json({ ok: true, data: record });
  }));

  // Post-hoc gaze estimation result: NDJSON body of samples, provenance in
  // headers, replaces the session's gaze log wholesale (§視線推定).
  router.put('/:id/gaze', handle(async (req, res) => {
    const context = storeContext(await configuredContext());
    if (!req.is('application/x-ndjson')) {
      throw Object.assign(new Error('Content-Type must be application/x-ndjson'), {
        statusCode: 415,
        code: 'NDJSON_CONTENT_TYPE_REQUIRED',
      });
    }
    const estimation = validateGazeEstimationMetaInput(req.headers);
    const record = await captureSessionService.replaceGazeSamples(context, req.params.id, {
      samples: parseGazeSampleLines(req),
      estimation,
    });
    res.json({ ok: true, data: record });
  }));

  router.get('/:id/gaze', handle(async (req, res) => {
    const context = storeContext(await configuredContext());
    res.json({ ok: true, data: await captureSessionService.gazeSamples(context, req.params.id) });
  }));

  return router;
}

module.exports = { createCaptureSessionRoutes };
