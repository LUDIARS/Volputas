import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GAZE_EXTRACTOR,
  createFrameThrottle,
  estimationHeaders,
  frameToSample,
  playThroughFrames,
  toNdjson,
} from './gazeEstimationRunner.js';

test('the frame throttle keeps at most targetFps frames per second of media time', () => {
  const keep = createFrameThrottle(10);
  const kept = [];
  for (let ms = 0; ms < 1000; ms += 33) if (keep(ms)) kept.push(ms);
  assert.equal(kept.length, 10);
  assert.equal(kept[0], 0);
  assert.ok(kept[1] >= 100);
});

test('frames without a face carry null features and land on the session clock', () => {
  const sample = frameToSample(1500, 250.4, null);
  assert.deepEqual(sample, { sessionMs: 1750, features: null });
});

test('NDJSON serialization and provenance headers match the server contract', () => {
  assert.equal(toNdjson([]), '');
  assert.equal(
    toNdjson([{ sessionMs: 0, x: 0.5, y: 0.5, valid: true }, { sessionMs: 66, x: 0, y: 0, valid: false }]),
    '{"sessionMs":0,"x":0.5,"y":0.5,"valid":true}\n{"sessionMs":66,"x":0,"y":0,"valid":false}\n'
  );
  assert.deepEqual(estimationHeaders({ calibrated: true, fitError: 0.03, frameRate: 15 }), {
    'content-type': 'application/x-ndjson',
    'x-gaze-extractor': GAZE_EXTRACTOR,
    'x-gaze-calibrated': 'true',
    'x-gaze-frame-rate': '15',
    'x-gaze-fit-error': '0.03',
  });
  assert.equal('x-gaze-fit-error' in estimationHeaders({ calibrated: false, fitError: null, frameRate: 15 }), false);
});

test('an already-aborted frame run rejects before video playback starts', async () => {
  const controller = new AbortController();
  controller.abort();
  let played = false;
  const video = {
    pause() {},
    addEventListener() {},
    removeEventListener() {},
    play() { played = true; return Promise.resolve(); },
  };
  await assert.rejects(
    playThroughFrames(video, {
      playbackRate: 4,
      onFrame() {},
      signal: controller.signal,
    }),
    (error) => error.name === 'AbortError'
  );
  assert.equal(played, false);
});
