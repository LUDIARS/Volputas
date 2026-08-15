import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lowerBound,
  mediaSecondsToSessionMs,
  samplesAround,
  sessionMsToMediaSeconds,
} from './gazeOverlay.js';

const SAMPLES = Array.from({ length: 100 }, (_, index) => ({
  sessionMs: index * 33, x: 0.5, y: 0.5, valid: true,
}));

test('lowerBound finds the first sample at or after a time', () => {
  assert.equal(lowerBound(SAMPLES, 0), 0);
  assert.equal(lowerBound(SAMPLES, 34), 2);
  assert.equal(lowerBound(SAMPLES, 33), 1);
  assert.equal(lowerBound(SAMPLES, 99999), 100);
  assert.equal(lowerBound([], 5), 0);
});

test('samplesAround returns the trailing window up to and including the playhead', () => {
  const window = samplesAround(SAMPLES, 1000, 600);
  assert.equal(window[0].sessionMs, 429);
  assert.equal(window.at(-1).sessionMs, 990);
  assert.deepEqual(samplesAround(SAMPLES, -50, 600), []);
  assert.deepEqual(samplesAround([], 10), []);
});

test('session clock and media time convert through the recording offset', () => {
  const recording = { startSessionMs: 1500 };
  assert.equal(sessionMsToMediaSeconds(recording, 4500), 3);
  assert.equal(sessionMsToMediaSeconds(recording, 500), 0);
  assert.equal(mediaSecondsToSessionMs(recording, 2.5), 4000);
});
