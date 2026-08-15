import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UNCALIBRATED_MAPPING,
  applyMapping,
  collectCalibrationSamples,
  estimateGaze,
  fitAffineMapping,
  mapFramesToGaze,
  solveLinearSystem,
} from './gazeCalibration.js';

// A synthetic "true" gaze model: screen x depends on irisX and yaw, y on irisY
// and pitch. The fit must recover it from noisy calibration frames.
const TRUE_X = [1.8, 0.1, 0.3, 0, -0.4];
const TRUE_Y = [0.05, 1.5, 0, 0.4, -0.25];

function truth(features) {
  return applyMapping({ weightsX: TRUE_X, weightsY: TRUE_Y }, features);
}

test('the linear solver handles pivoting and reports singular systems', () => {
  assert.deepEqual(
    solveLinearSystem([[0, 2], [3, 0]], [4, 9]).map((value) => Number(value.toFixed(6))),
    [3, 2]
  );
  assert.equal(solveLinearSystem([[1, 2], [2, 4]], [1, 2]), null);
});

test('affine calibration recovers the mapping from calibration frames', () => {
  const samples = [];
  let seed = 7;
  const noise = () => {
    // Deterministic small noise so the test is repeatable.
    seed = (seed * 9301 + 49297) % 233280;
    return (seed / 233280 - 0.5) * 0.02;
  };
  for (const irisX of [0.3, 0.5, 0.7]) {
    for (const irisY of [0.3, 0.5, 0.7]) {
      for (const yaw of [-0.2, 0, 0.2]) {
        const features = [irisX, irisY, yaw, 0.1 * yaw, 1];
        const target = truth(features);
        samples.push({ features, x: target.x + noise(), y: target.y + noise() });
      }
    }
  }
  const mapping = fitAffineMapping(samples);
  assert.ok(mapping, 'mapping should be solvable');
  assert.ok(mapping.fitError < 0.02, `fit error ${mapping.fitError}`);
  const probe = [0.62, 0.41, 0.1, 0.01, 1];
  const predicted = applyMapping(mapping, probe);
  const expected = truth(probe);
  assert.ok(Math.abs(predicted.x - expected.x) < 0.03, `x ${predicted.x} vs ${expected.x}`);
  assert.ok(Math.abs(predicted.y - expected.y) < 0.03, `y ${predicted.y} vs ${expected.y}`);
  assert.equal(fitAffineMapping(samples.slice(0, 3)), null);
});

test('calibration windows select their frames and estimateGaze flags the mode', () => {
  const points = [
    { x: 0.1, y: 0.1, fromSessionMs: 1000, toSessionMs: 2000 },
    { x: 0.9, y: 0.1, fromSessionMs: 3000, toSessionMs: 4000 },
    { x: 0.5, y: 0.9, fromSessionMs: 5000, toSessionMs: 6000 },
    { x: 0.1, y: 0.9, fromSessionMs: 7000, toSessionMs: 8000 },
    { x: 0.9, y: 0.9, fromSessionMs: 9000, toSessionMs: 10000 },
  ];
  const frames = [];
  for (const point of points) {
    // Two frames per window with features that linearly encode the target.
    for (const offset of [100, 600]) {
      frames.push({
        sessionMs: point.fromSessionMs + offset,
        features: [point.x, point.y, (point.x - 0.5) * 0.1, (point.y - 0.5) * 0.1, 1],
      });
    }
  }
  frames.push({ sessionMs: 2500, features: [0.5, 0.5, 0, 0, 1] }); // between windows
  frames.push({ sessionMs: 12000, features: null }); // blink
  frames.push({ sessionMs: 12033, features: [0.9, 0.1, 0.04, -0.04, 1] });

  const training = collectCalibrationSamples(frames, points);
  assert.equal(training.length, 10);
  assert.equal(training[0].x, 0.1);

  const estimate = estimateGaze(frames, points);
  assert.equal(estimate.calibrated, true);
  assert.equal(estimate.calibrationSampleCount, 10);
  assert.ok(estimate.fitError < 0.01);
  assert.equal(estimate.samples.length, frames.length);
  const blink = estimate.samples.find((sample) => sample.sessionMs === 12000);
  assert.deepEqual(blink, { sessionMs: 12000, x: 0, y: 0, valid: false });
  const last = estimate.samples.at(-1);
  assert.ok(Math.abs(last.x - 0.9) < 0.05 && Math.abs(last.y - 0.1) < 0.05, JSON.stringify(last));

  const fallback = estimateGaze(frames, null);
  assert.equal(fallback.calibrated, false);
  assert.equal(fallback.fitError, null);
  assert.equal(fallback.samples.length, frames.length);
  const centered = mapFramesToGaze([{ sessionMs: 0, features: [0.5, 0.5, 0, 0, 1] }], UNCALIBRATED_MAPPING)[0];
  assert.ok(centered.x > 0.3 && centered.x < 0.7 && centered.y > 0.3 && centered.y < 0.7, JSON.stringify(centered));
  const clamped = mapFramesToGaze([{ sessionMs: 0, features: [-50, 50, 0, 0, 1] }], UNCALIBRATED_MAPPING)[0];
  assert.equal(clamped.x, 3);
  assert.equal(clamped.y, 3);
});
