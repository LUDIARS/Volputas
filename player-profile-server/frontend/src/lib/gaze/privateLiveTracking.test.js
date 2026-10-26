import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateLiveTracking, trackingSample } from './privateLiveTracking.js';

function fixture(overrides = {}) {
  const calls = { stopped: 0, closed: 0, samples: [], errors: [], requests: [] };
  const track = { stop() { calls.stopped++; }, addEventListener() {}, removeEventListener() {} };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  const video = { readyState: 2, currentTime: 1, play: async () => {}, pause() {} };
  const tracker = createPrivateLiveTracking({
    onSample: (sample) => calls.samples.push(sample), onError: (error) => calls.errors.push(error),
    sessionClock: () => 100, now: () => 1,
    mediaDevices: { getUserMedia: async (constraints) => { calls.requests.push(constraints); return stream; } },
    loadModel: async () => ({ detectTracking: () => ({ faceLandmarks: [], pixels: 'secret' }), close() { calls.closed++; } }),
    createVideo: () => video, schedule: () => 1, cancel() {}, ...overrides,
  });
  return { tracker, calls, video, stream };
}

test('tracking owns an audio-free front camera and exposes only numeric derived data', async () => {
  const { tracker, calls, video } = fixture();
  await tracker.start();
  assert.equal(calls.requests[0].audio, false);
  assert.equal(calls.requests[0].video.facingMode, 'user');
  assert.deepEqual(Object.keys(tracker).sort(), ['start', 'stop']);
  assert.equal(JSON.stringify(calls.samples).includes('secret'), false);
  tracker.stop();
  tracker.stop();
  assert.equal(calls.stopped, 1);
  assert.equal(calls.closed, 1);
  assert.equal(video.srcObject, null);
});

test('late camera permission after stop cannot resurrect capture', async () => {
  let resolveCamera;
  const pending = new Promise((resolve) => { resolveCamera = resolve; });
  const { tracker, stream, calls } = fixture({ mediaDevices: { getUserMedia: () => pending } });
  const starting = tracker.start();
  await Promise.resolve();
  tracker.stop();
  resolveCamera(stream);
  await starting;
  assert.equal(calls.stopped, 1);
  assert.equal(calls.closed, 1);
  assert.equal(calls.samples.length, 0);
});

test('permission denial closes the model and reports failure', async () => {
  const { tracker, calls } = fixture({ mediaDevices: { getUserMedia: async () => { throw new Error('denied'); } } });
  await tracker.start();
  assert.equal(calls.closed, 1);
  assert.equal(calls.errors[0].message, 'denied');
  assert.equal(calls.samples.length, 0);
});

test('sample projection excludes frames, full meshes and invalid coefficients', () => {
  const sample = trackingSample({ pixels: 'secret', faceLandmarks: [], faceBlendshapes: [{ categories: [
    { categoryName: 'jawOpen', score: 0.4 }, { categoryName: 'invalid', score: NaN },
  ] }] }, 200);
  assert.deepEqual(sample.expressions, { jawOpen: 0.4 });
  assert.equal(sample.eyes, null);
  assert.equal('faceLandmarks' in sample, false);
  assert.equal('pixels' in sample, false);
});
