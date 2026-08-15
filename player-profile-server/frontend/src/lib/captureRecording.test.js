import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUDIO_MIME_CANDIDATES,
  TrackRecorder,
  VIDEO_MIME_CANDIDATES,
  assertBlobWithinLimit,
  audioHeaders,
  baseMimeType,
  pickMimeType,
  recordingHeaders,
  sessionClockMs,
} from './captureRecording.js';

test('mime selection prefers the first supported candidate and tolerates missing MediaRecorder', () => {
  const supported = new Set(['video/webm', 'audio/webm']);
  const MediaRecorderType = { isTypeSupported: (type) => supported.has(type) };
  assert.equal(pickMimeType(VIDEO_MIME_CANDIDATES, MediaRecorderType), 'video/webm');
  assert.equal(pickMimeType(AUDIO_MIME_CANDIDATES, MediaRecorderType), 'audio/webm');
  assert.equal(pickMimeType(VIDEO_MIME_CANDIDATES, undefined), '');
  assert.equal(baseMimeType('video/webm;codecs=vp9,opus'), 'video/webm');
});

test('session clock and upload headers follow the server header contract', () => {
  const startedAt = '2026-08-16T00:00:00.000Z';
  assert.equal(sessionClockMs(startedAt, Date.parse(startedAt) + 1234), 1234);
  assert.equal(sessionClockMs(startedAt, Date.parse(startedAt) - 5), 0);
  assert.deepEqual(recordingHeaders({
    contentType: 'video/webm', startSessionMs: 1500.6, durationSeconds: 61.2, width: 1920, height: 1080,
  }), {
    'content-type': 'video/webm',
    'x-capture-start-session-ms': '1501',
    'x-capture-duration-seconds': '61.2',
    'x-capture-width': '1920',
    'x-capture-height': '1080',
  });
  assert.deepEqual(recordingHeaders({ contentType: 'video/mp4', startSessionMs: 0, durationSeconds: null }), {
    'content-type': 'video/mp4',
    'x-capture-start-session-ms': '0',
  });
  assert.deepEqual(audioHeaders({ contentType: 'audio/webm', startSessionMs: 20, durationSeconds: 5 }), {
    'content-type': 'audio/webm',
    'x-audio-start-session-ms': '20',
    'x-audio-duration-seconds': '5',
  });
});

test('blob limits are enforced with a readable message', () => {
  assert.throws(() => assertBlobWithinLimit(new Blob([]), 10, '録画'), /録画が空です/);
  assert.throws(() => assertBlobWithinLimit(new Blob(['abcdef']), 5, '録画'), /上限/);
  assert.equal(assertBlobWithinLimit(new Blob(['abc']), 5, '録画').size, 3);
});

// A minimal MediaRecorder stand-in: emits one chunk on stop.
class FakeMediaRecorder {
  constructor(stream, options) {
    this.stream = stream;
    this.mimeType = options?.mimeType || 'video/webm';
    this.state = 'inactive';
    this.stopCalls = 0;
  }

  start() {
    this.state = 'recording';
    queueMicrotask(() => this.onstart?.());
  }

  stop() {
    this.stopCalls += 1;
    this.state = 'inactive';
    queueMicrotask(() => {
      this.ondataavailable?.({ data: new Blob(['frames'], { type: this.mimeType }) });
      this.onstop?.();
    });
  }
}

test('TrackRecorder notes the session clock at start and stop and returns the blob', async () => {
  let clock = 2000;
  const recorder = new TrackRecorder({
    stream: {},
    mimeType: 'video/webm;codecs=vp9',
    MediaRecorderType: FakeMediaRecorder,
    sessionClock: () => clock,
  });
  const startSessionMs = await recorder.start();
  assert.equal(startSessionMs, 2000);
  assert.equal(recorder.active, true);
  clock = 62000;
  const firstStop = recorder.stop();
  const secondStop = recorder.stop();
  assert.strictEqual(secondStop, firstStop);
  const result = await firstStop;
  assert.equal(recorder.active, false);
  assert.equal(result.startSessionMs, 2000);
  assert.equal(result.durationSeconds, 60);
  assert.equal(result.contentType, 'video/webm');
  assert.equal(result.blob.size, 6);
  assert.equal(recorder.recorder.stopCalls, 1);
  // Stopping again is a no-op that still yields the recorded result.
  assert.equal((await recorder.stop()).blob.size, 6);
});
