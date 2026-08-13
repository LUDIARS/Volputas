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
  const service = new CaptureSessionService({
    recordStore,
    gazeLog,
    audioStore,
    pairing: new CapturePairing({ now: () => nowMs }),
    now: () => new Date(nowMs),
  });
  return { service, recordStore, gazeLog, advance: (ms) => { nowMs += ms; } };
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
    pairing: new CapturePairing(),
  });

  assert.equal(await restartedService.active(CONTEXT), null);
  const [recovered] = await restartedService.list(CONTEXT);
  assert.equal(recovered.id, started.id);
  assert.equal(recovered.status, 'interrupted');
  assert.equal(recovered.endedAt, null);
  assert.equal(recovered.capture.gazeSampleCount, 1);
});
