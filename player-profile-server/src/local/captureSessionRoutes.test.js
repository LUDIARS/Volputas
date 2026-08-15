const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { errorHandler } = require('../middleware/errorHandler');
const { createCaptureSessionRoutes } = require('./captureSessionRoutes');

async function startedRouter(t) {
  let stopCalls = 0;
  const captureSessionService = {
    async initialize() {},
    async stop() {
      stopCalls += 1;
      return { status: 'completed' };
    },
  };
  const app = express();
  app.use(express.json());
  app.use('/api/local/capture-sessions', createCaptureSessionRoutes({
    captureSessionService,
    configuredContext: async () => ({
      config: { name: 'tester' },
      gitAuthor: { repositoryRoot: '/repo' },
    }),
    companionInfo: () => ({ enabled: false }),
  }));
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    stopCalls: () => stopCalls,
  };
}

test('local capture mutations reject form-compatible content types', async (t) => {
  const { origin, stopCalls } = await startedRouter(t);
  const formResponse = await fetch(`${origin}/api/local/capture-sessions/active/stop`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: '{}',
  });
  assert.equal(formResponse.status, 415);
  assert.equal((await formResponse.json()).error.code, 'JSON_CONTENT_TYPE_REQUIRED');
  assert.equal(stopCalls(), 0);

  const jsonResponse = await fetch(`${origin}/api/local/capture-sessions/active/stop`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(jsonResponse.status, 200);
  assert.equal(stopCalls(), 1);
});

async function mediaRouter(t) {
  const calls = [];
  const captureSessionService = {
    async initialize() {},
    async attachVideo(_context, sessionId, input) {
      const { stream, ...rest } = input;
      let bytes = 0;
      for await (const chunk of stream) bytes += chunk.length;
      calls.push({ op: 'video', sessionId, bytes, ...rest });
      return { fileName: `${sessionId}.webm`, bytes };
    },
    async attachAudioLocal(_context, sessionId, input) {
      const { stream, ...rest } = input;
      calls.push({ op: 'audio', sessionId, ...rest, hasStream: Boolean(stream) });
      return { fileName: `${sessionId}.webm`, bytes: 1 };
    },
    async saveCalibration(_context, sessionId, input) {
      calls.push({ op: 'calibration', sessionId, ...input });
      return { id: sessionId, calibration: input };
    },
    async replaceGazeSamples(_context, sessionId, { samples, estimation }) {
      const collected = [];
      for await (const sample of samples) collected.push(sample);
      calls.push({ op: 'gaze', sessionId, samples: collected, estimation });
      return { id: sessionId, capture: { gazeSampleCount: collected.length } };
    },
    async gazeSamples() {
      return [{ sessionMs: 0, x: 0.5, y: 0.5, valid: true }];
    },
  };
  const app = express();
  app.use(express.json());
  app.use('/api/local/capture-sessions', createCaptureSessionRoutes({
    captureSessionService,
    configuredContext: async () => ({
      config: { name: 'tester' },
      gitAuthor: { repositoryRoot: '/repo' },
    }),
    companionInfo: () => ({ enabled: false }),
  }));
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  return { origin: `http://127.0.0.1:${server.address().port}`, calls };
}

test('recording uploads carry their session-clock anchor in headers', async (t) => {
  const { origin, calls } = await mediaRouter(t);
  const base = `${origin}/api/local/capture-sessions/s1/recordings`;
  const missingAnchor = await fetch(`${base}/screen`, {
    method: 'PUT', headers: { 'content-type': 'video/webm' }, body: 'abc',
  });
  assert.equal(missingAnchor.status, 400);
  assert.equal(calls.length, 0);

  const unknownKind = await fetch(`${base}/audio`, {
    method: 'PUT',
    headers: { 'content-type': 'video/webm', 'x-capture-start-session-ms': '0' },
    body: 'abc',
  });
  assert.equal(unknownKind.status, 400);

  const ok = await fetch(`${base}/screen`, {
    method: 'PUT',
    headers: {
      'content-type': 'video/webm; codecs=vp9',
      'x-capture-start-session-ms': '1200',
      'x-capture-duration-seconds': '30',
    },
    body: 'abcdef',
  });
  assert.equal(ok.status, 201);
  assert.deepEqual(calls[0], {
    op: 'video', sessionId: 's1', bytes: 6, kind: 'screen', contentType: 'video/webm',
    startSessionMs: 1200, durationSeconds: 30, width: null, height: null,
  });
});

test('desktop audio upload reuses the companion header contract', async (t) => {
  const { origin, calls } = await mediaRouter(t);
  const response = await fetch(`${origin}/api/local/capture-sessions/s1/audio`, {
    method: 'PUT',
    headers: {
      'content-type': 'audio/webm',
      'x-audio-start-session-ms': '300',
      'x-audio-duration-seconds': '12',
    },
    body: 'abc',
  });
  assert.equal(response.status, 201);
  assert.deepEqual(calls[0], {
    op: 'audio', sessionId: 's1', contentType: 'audio/webm', durationSeconds: 12,
    startSessionMs: 300, hasStream: true,
  });
});

test('calibration is JSON-only and gaze replacement streams NDJSON with provenance', async (t) => {
  const { origin, calls } = await mediaRouter(t);
  const points = [
    { x: 0.1, y: 0.1, fromSessionMs: 0, toSessionMs: 1000 },
    { x: 0.9, y: 0.1, fromSessionMs: 2000, toSessionMs: 3000 },
    { x: 0.5, y: 0.9, fromSessionMs: 4000, toSessionMs: 5000 },
  ];
  const calibration = await fetch(`${origin}/api/local/capture-sessions/s1/calibration`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ points, screen: { width: 1920, height: 1080 } }),
  });
  assert.equal(calibration.status, 200);
  assert.equal(calls[0].op, 'calibration');
  assert.equal(calls[0].points.length, 3);

  const wrongType = await fetch(`${origin}/api/local/capture-sessions/s1/gaze`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-gaze-extractor': 'mp', 'x-gaze-calibrated': 'true' },
    body: '[]',
  });
  assert.equal(wrongType.status, 415);

  const gaze = await fetch(`${origin}/api/local/capture-sessions/s1/gaze`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/x-ndjson',
      'x-gaze-extractor': 'mediapipe-face-landmarker+affine-calibration',
      'x-gaze-calibrated': 'true',
      'x-gaze-fit-error': '0.03',
      'x-gaze-frame-rate': '30',
    },
    body: '{"sessionMs":0,"x":0.5,"y":0.5}\n{"sessionMs":33,"x":0.5,"y":0.6,"valid":true}\n',
  });
  assert.equal(gaze.status, 200);
  const gazeCall = calls.find((call) => call.op === 'gaze');
  assert.equal(gazeCall.samples.length, 2);
  assert.equal(gazeCall.estimation.calibrated, true);
  assert.equal(gazeCall.estimation.fitError, 0.03);

  const invalidLine = await fetch(`${origin}/api/local/capture-sessions/s1/gaze`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/x-ndjson',
      'x-gaze-extractor': 'mp',
      'x-gaze-calibrated': 'false',
    },
    body: '{"sessionMs":0,"x":9,"y":0.5}\n',
  });
  assert.equal(invalidLine.status, 400);

  const listed = await fetch(`${origin}/api/local/capture-sessions/s1/gaze`);
  assert.equal((await listed.json()).data.length, 1);
});
