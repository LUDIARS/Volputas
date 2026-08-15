const test = require('node:test');
const assert = require('node:assert/strict');
const { CapturePairing } = require('./capturePairing');
const { CaptureSessionService } = require('./captureSessionService');

const CONTEXT = { repositoryRoot: '/repo', name: 'tester' };

function fakeRecordStore() {
  const records = new Map();
  let sequence = 0;
  return {
    records,
    async list() {
      return [...records.values()];
    },
    async write({ data }) {
      const id = data.id || `record-${(sequence += 1)}`;
      const record = { schemaVersion: 1, ...data, id };
      records.set(id, record);
      return { filePath: `/repo/${id}.json`, record };
    },
  };
}

function fakeGazeLog() {
  const samplesBySession = new Map();
  return {
    samplesBySession,
    async append({ sessionId }, samples) {
      const existing = samplesBySession.get(sessionId) || [];
      samplesBySession.set(sessionId, [...existing, ...samples]);
      return { appended: samples.length };
    },
    async read({ sessionId }) {
      return samplesBySession.get(sessionId) || [];
    },
    async replace({ sessionId }, samples) {
      const collected = [];
      for await (const sample of samples) collected.push(sample);
      samplesBySession.set(sessionId, collected);
      return { filePath: `/media/${sessionId}.jsonl`, written: collected.length };
    },
  };
}

function fakeVideoStore() {
  const saved = [];
  return {
    saved,
    async save({ sessionId, kind, contentType }) {
      saved.push({ sessionId, kind, contentType });
      return { filePath: `/media/${kind}/${sessionId}.webm`, fileName: `${sessionId}.webm`, bytes: 7, contentType, kind };
    },
    async resolve({ sessionId, kind }) {
      return saved.some((entry) => entry.sessionId === sessionId && entry.kind === kind)
        ? { filePath: `/media/${kind}/${sessionId}.webm`, contentType: 'video/webm' }
        : null;
    },
  };
}

function createService({ startMs = 0 } = {}) {
  let nowMs = startMs;
  const recordStore = fakeRecordStore();
  const gazeLog = fakeGazeLog();
  const audioStore = {
    async save({ sessionId, contentType }) {
      return { filePath: `/media/${sessionId}.webm`, fileName: `${sessionId}.webm`, bytes: 3, contentType };
    },
    async resolve() { return null; },
  };
  const videoStore = fakeVideoStore();
  const service = new CaptureSessionService({
    recordStore,
    gazeLog,
    audioStore,
    videoStore,
    pairing: new CapturePairing({ now: () => nowMs }),
    now: () => new Date(nowMs),
  });
  return { service, recordStore, gazeLog, videoStore, advance: (ms) => { nowMs += ms; } };
}

test('a game start signal opens a session and a second start is rejected', async () => {
  const { service } = createService();
  const record = await service.handleSignal(CONTEXT, {
    action: 'start', gameTitle: 'X', gameClockMs: 500,
  });
  assert.equal(record.status, 'recording');
  assert.equal(record.source, 'game-signal');
  assert.deepEqual(record.anchors, [{ sessionMs: 0, gameClockMs: 500 }]);
  await assert.rejects(
    service.handleSignal(CONTEXT, { action: 'start', gameTitle: 'Y', gameClockMs: null }),
    /already recording/
  );
});

test('markers land on the session clock and game clocks become anchors', async () => {
  const { service, advance } = createService();
  await service.start(CONTEXT, { gameTitle: 'X', gameClockMs: null }, 'manual');
  advance(12000);
  const record = await service.addMarker('game', {
    type: 'event', label: 'boss', sessionMs: null, gameClockMs: 90000,
  });
  assert.deepEqual(record.markers, [
    { sessionMs: 12000, origin: 'game', type: 'event', label: 'boss' },
  ]);
  assert.deepEqual(record.anchors, [{ sessionMs: 12000, gameClockMs: 90000 }]);
});

test('marker and stop signals without a session are a 409, not a silent no-op', async () => {
  const { service } = createService();
  await assert.rejects(
    service.handleSignal(CONTEXT, { action: 'marker', type: 'hype', label: '', sessionMs: null, gameClockMs: null }),
    /No capture session is recording/
  );
  await assert.rejects(service.handleSignal(CONTEXT, { action: 'stop', gameClockMs: null }), /No capture session/);
});

test('a companion joins, syncs, streams gaze, and taps markers', async () => {
  const { service, gazeLog, advance } = createService();
  await service.start(CONTEXT, { gameTitle: 'X', gameClockMs: null }, 'manual');
  const { code } = await service.issuePairing();
  const { token } = await service.join(code);

  advance(5000);
  assert.equal(service.sync(token, { clientSentAtMs: 1 }).sessionMs, 5000);

  const ingested = await service.ingestGaze(token, {
    samples: [{ sessionMs: 5100, x: 0.5, y: 0.5, valid: true }],
  });
  assert.deepEqual(ingested, { accepted: 1, total: 1 });

  const record = await service.companionMarker(token, {
    type: 'hype', label: '', sessionMs: 5200, gameClockMs: null,
  });
  assert.equal(record.markers[0].origin, 'companion');

  const stopped = await service.stop();
  assert.equal(stopped.status, 'completed');
  // The volatile gaze count is folded into the persisted record at stop.
  assert.equal(stopped.capture.gazeSampleCount, 1);
  assert.equal(gazeLog.samplesBySession.get(stopped.id).length, 1);
});

test('gaze and sync are refused after stop, but audio upload still lands', async () => {
  const { service } = createService();
  await service.start(CONTEXT, { gameTitle: 'X', gameClockMs: null }, 'manual');
  const { code } = await service.issuePairing();
  const { token } = await service.join(code);
  await assert.rejects(
    service.attachAudio(token, {
      contentType: 'audio/webm', stream: null, durationSeconds: 42,
    }),
    /Stop the capture session/
  );
  await service.stop();

  assert.throws(() => service.sync(token, { clientSentAtMs: 1 }), /has stopped/);
  await assert.rejects(
    service.ingestGaze(token, { samples: [{ sessionMs: 0, x: 0, y: 0, valid: true }] }),
    /has stopped/
  );
  assert.equal(service.companionState(token).status, 'completed');

  const uploaded = await service.attachAudio(token, {
    contentType: 'audio/webm', stream: null, durationSeconds: 42,
  });
  assert.match(uploaded.fileName, /\.webm$/);
  const records = await service.list(CONTEXT);
  assert.equal(records[0].capture.audioFileName, uploaded.fileName);
  assert.equal(records[0].capture.audioDurationSeconds, 42);
  await assert.rejects(
    service.attachAudio(token, {
      contentType: 'audio/webm', stream: null, durationSeconds: 42,
    }),
    /already been uploaded/
  );
});

test('the timeline endpoint composes record, markers, and stored gaze', async () => {
  const { service, advance } = createService();
  const started = await service.start(CONTEXT, { gameTitle: 'X', gameClockMs: null }, 'manual');
  const { code } = await service.issuePairing();
  const { token } = await service.join(code);
  await service.ingestGaze(token, {
    samples: [{ sessionMs: 1000, x: 0.5, y: 0.5, valid: true }],
  });
  advance(30000);
  await service.stop();
  const timeline = await service.timeline(CONTEXT, started.id);
  assert.equal(timeline.durationMs, 30000);
  assert.equal(timeline.gaze.length, 1);
  await assert.rejects(service.timeline(CONTEXT, 'missing'), /not found/);
});

test('marker and stop writes are serialized into one completed record', async () => {
  const recordStore = fakeRecordStore();
  let releaseMarkerWrite;
  let markerWriteStarted;
  const markerStarted = new Promise((resolve) => { markerWriteStarted = resolve; });
  const markerRelease = new Promise((resolve) => { releaseMarkerWrite = resolve; });
  let delayNextWrite = false;
  const delayedStore = {
    ...recordStore,
    async write(input) {
      if (delayNextWrite) {
        delayNextWrite = false;
        markerWriteStarted();
        await markerRelease;
      }
      return recordStore.write(input);
    },
  };
  const service = new CaptureSessionService({
    recordStore: delayedStore,
    gazeLog: fakeGazeLog(),
    audioStore: { async save() {}, async resolve() { return null; } },
    videoStore: fakeVideoStore(),
    pairing: new CapturePairing(),
  });
  await service.start(CONTEXT, { gameTitle: 'X', gameClockMs: null }, 'manual');
  delayNextWrite = true;
  const marker = service.addMarker('desktop', {
    type: 'hype', label: '', sessionMs: 100, gameClockMs: null,
  });
  await markerStarted;
  const stopped = service.stop();
  releaseMarkerWrite();

  await marker;
  const completed = await stopped;
  assert.equal(completed.status, 'completed');
  assert.equal(completed.markers.length, 1);
  assert.equal(recordStore.records.get(completed.id).status, 'completed');
  assert.equal(recordStore.records.get(completed.id).markers.length, 1);
});

test('startup recovery marks persisted recording sessions as interrupted', async () => {
  const recordStore = fakeRecordStore();
  const gazeLog = fakeGazeLog();
  const firstService = new CaptureSessionService({
    recordStore,
    gazeLog,
    audioStore: { async save() {}, async resolve() { return null; } },
    videoStore: fakeVideoStore(),
    pairing: new CapturePairing(),
  });
  const started = await firstService.start(
    CONTEXT,
    { gameTitle: 'Interrupted', gameClockMs: null },
    'manual'
  );
  await gazeLog.append(
    { ...CONTEXT, sessionId: started.id },
    [{ sessionMs: 50, x: 0.5, y: 0.5, valid: true }]
  );
  const restartedService = new CaptureSessionService({
    recordStore,
    gazeLog,
    audioStore: { async save() {}, async resolve() { return null; } },
    videoStore: fakeVideoStore(),
    pairing: new CapturePairing(),
  });

  assert.equal(await restartedService.active(CONTEXT), null);
  const [recovered] = await restartedService.list(CONTEXT);
  assert.equal(recovered.id, started.id);
  assert.equal(recovered.status, 'interrupted');
  assert.equal(recovered.endedAt, null);
  assert.equal(recovered.capture.gazeSampleCount, 1);
});

test('desktop capture uploads audio without a token and refuses a second copy', async () => {
  const { service } = createService();
  const started = await service.start(CONTEXT, { gameTitle: 'X', gameClockMs: null }, 'manual');
  await assert.rejects(
    service.attachAudioLocal(CONTEXT, started.id, {
      contentType: 'audio/webm', stream: null, durationSeconds: 10, startSessionMs: 0,
    }),
    /Stop the capture session/
  );
  await service.stop();
  const uploaded = await service.attachAudioLocal(CONTEXT, started.id, {
    contentType: 'audio/webm', stream: null, durationSeconds: 10, startSessionMs: 250,
  });
  assert.equal(uploaded.fileName, `${started.id}.webm`);
  const record = await service.findRecord(CONTEXT, started.id);
  assert.equal(record.capture.audioStartSessionMs, 250);
  await assert.rejects(
    service.attachAudioLocal(CONTEXT, started.id, {
      contentType: 'audio/webm', stream: null, durationSeconds: 10, startSessionMs: 0,
    }),
    /already been uploaded/
  );
});

test('screen and face recordings are anchored on the session clock and may be replaced', async () => {
  const { service, videoStore } = createService();
  const started = await service.start(CONTEXT, { gameTitle: 'X', gameClockMs: null }, 'manual');
  await assert.rejects(
    service.attachVideo(CONTEXT, started.id, {
      kind: 'screen', contentType: 'video/webm', stream: null, startSessionMs: 0,
      durationSeconds: 60, width: 1920, height: 1080,
    }),
    /Stop the capture session/
  );
  await service.stop();
  await service.attachVideo(CONTEXT, started.id, {
    kind: 'screen', contentType: 'video/webm', stream: null, startSessionMs: 1200,
    durationSeconds: 60, width: 1920, height: 1080,
  });
  await service.attachVideo(CONTEXT, started.id, {
    kind: 'face', contentType: 'video/webm', stream: null, startSessionMs: 0,
    durationSeconds: 61.5, width: null, height: null,
  });
  let record = await service.findRecord(CONTEXT, started.id);
  assert.equal(record.capture.screenRecording.startSessionMs, 1200);
  assert.equal(record.capture.screenRecording.width, 1920);
  assert.equal(record.capture.faceRecording.durationSeconds, 61.5);
  assert.equal(record.capture.audioFileName, null);

  // An external recorder file replaces the in-browser capture.
  await service.attachVideo(CONTEXT, started.id, {
    kind: 'screen', contentType: 'video/mp4', stream: null, startSessionMs: 0,
    durationSeconds: 65, width: null, height: null,
  });
  record = await service.findRecord(CONTEXT, started.id);
  assert.equal(record.capture.screenRecording.contentType, 'video/mp4');
  assert.equal(record.capture.screenRecording.startSessionMs, 0);
  assert.equal(videoStore.saved.length, 3);
  assert.equal((await service.resolveVideo(CONTEXT, started.id, 'face')).contentType, 'video/webm');
});

test('calibration is stored on the record and post-hoc gaze replaces live samples', async () => {
  const { service, gazeLog, advance } = createService();
  const started = await service.start(CONTEXT, { gameTitle: 'X', gameClockMs: null }, 'manual');
  const calibrated = await service.saveCalibration(CONTEXT, started.id, {
    screen: { width: 2560, height: 1440 },
    points: [
      { x: 0.1, y: 0.1, fromSessionMs: 1000, toSessionMs: 2500 },
      { x: 0.9, y: 0.1, fromSessionMs: 3000, toSessionMs: 4500 },
      { x: 0.5, y: 0.9, fromSessionMs: 5000, toSessionMs: 6500 },
    ],
  });
  assert.equal(calibrated.calibration.points.length, 3);
  assert.equal(calibrated.calibration.screen.width, 2560);

  const { code } = await service.issuePairing();
  const { token } = await service.join(code);
  await service.ingestGaze(token, { samples: [{ sessionMs: 100, x: 0.5, y: 0.5, valid: true }] });
  advance(10000);
  await service.stop();

  const replaced = await service.replaceGazeSamples(CONTEXT, started.id, {
    samples: (async function* samples() {
      yield { sessionMs: 0, x: 0.2, y: 0.2, valid: true };
      yield { sessionMs: 33, x: 0.21, y: 0.2, valid: true };
    }()),
    estimation: {
      extractor: 'mediapipe-face-landmarker+affine-calibration',
      calibrated: true,
      fitError: 0.04,
      frameRate: 30,
    },
  });
  assert.equal(replaced.capture.gazeSampleCount, 2);
  assert.equal(replaced.capture.gazeSource, 'face-video');
  assert.equal(replaced.gazeEstimation.calibrated, true);
  assert.equal(replaced.gazeEstimation.sampleCount, 2);
  assert.deepEqual(gazeLog.samplesBySession.get(started.id).map((sample) => sample.x), [0.2, 0.21]);
  assert.equal((await service.gazeSamples(CONTEXT, started.id)).length, 2);
  const timeline = await service.timeline(CONTEXT, started.id);
  assert.equal(timeline.gazeSource, 'face-video');
});
