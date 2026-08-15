// Affine gaze calibration: least-squares fit from the per-frame feature vector
// (gazeFeatures.js) to normalized screen coordinates, trained on the frames
// that fall inside the calibration windows recorded at capture start
// (spec/feature/emotion-capture-companion.md §視線推定). Pure linear algebra;
// no DOM, no MediaPipe.
import { FEATURE_COUNT } from './gazeFeatures.js';

// Ridge term keeps the normal equations solvable when a calibration only spans
// a line of targets (e.g. all points on one row) or the head never moved.
const RIDGE = 1e-3;

/** @implements SPEC-EMOTION-CAPTURE-COMPANION */
export function solveLinearSystem(matrix, vector) {
  const n = vector.length;
  const a = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < n; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < n; row += 1) {
      if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) pivot = row;
    }
    if (Math.abs(a[pivot][column]) < 1e-12) return null;
    [a[column], a[pivot]] = [a[pivot], a[column]];
    for (let row = 0; row < n; row += 1) {
      if (row === column) continue;
      const factor = a[row][column] / a[column][column];
      for (let k = column; k <= n; k += 1) a[row][k] -= factor * a[column][k];
    }
  }
  return a.map((row, index) => row[n] / row[index]);
}

// Solves w = argmin Σ (features·w − target)² + ridge‖w‖² per output axis.
/** @implements SPEC-EMOTION-CAPTURE-COMPANION */
export function fitAffineMapping(samples, { ridge = RIDGE } = {}) {
  const usable = samples.filter((sample) => Array.isArray(sample.features)
    && sample.features.length === FEATURE_COUNT
    && sample.features.every(Number.isFinite));
  if (usable.length < FEATURE_COUNT) return null;
  const normal = Array.from({ length: FEATURE_COUNT }, () => Array(FEATURE_COUNT).fill(0));
  const rhsX = Array(FEATURE_COUNT).fill(0);
  const rhsY = Array(FEATURE_COUNT).fill(0);
  for (const { features, x, y } of usable) {
    for (let i = 0; i < FEATURE_COUNT; i += 1) {
      rhsX[i] += features[i] * x;
      rhsY[i] += features[i] * y;
      for (let j = 0; j < FEATURE_COUNT; j += 1) normal[i][j] += features[i] * features[j];
    }
  }
  // Do not regularize the bias term; only the slopes.
  for (let i = 0; i < FEATURE_COUNT - 1; i += 1) normal[i][i] += ridge * usable.length;
  const weightsX = solveLinearSystem(normal, rhsX);
  const weightsY = solveLinearSystem(normal, rhsY);
  if (!weightsX || !weightsY) return null;
  const mapping = { weightsX, weightsY };
  const errors = usable.map((sample) => {
    const predicted = applyMapping(mapping, sample.features);
    return Math.hypot(predicted.x - sample.x, predicted.y - sample.y);
  });
  const fitError = errors.reduce((sum, value) => sum + value, 0) / errors.length;
  return { ...mapping, fitError, sampleCount: usable.length };
}

/** @implements SPEC-EMOTION-CAPTURE-COMPANION */
export function applyMapping(mapping, features) {
  let x = 0;
  let y = 0;
  for (let i = 0; i < FEATURE_COUNT; i += 1) {
    x += mapping.weightsX[i] * features[i];
    y += mapping.weightsY[i] * features[i];
  }
  return { x, y };
}

// Without calibration the only honest option is a coarse heuristic: iris
// position inside the eye opening spans the screen, head pose nudges it. It is
// flagged as uncalibrated on the record so nobody mistakes it for measurement.
/** @implements SPEC-EMOTION-CAPTURE-COMPANION */
export const UNCALIBRATED_MAPPING = Object.freeze({
  // Screen x from image-space irisX; the camera image is mirrored relative to
  // the screen, so image-right iris means the player looks screen-left.
  weightsX: [-1.6, 0, -0.5, 0, 1.3],
  weightsY: [0, 1.6, 0, 0.5, -0.3],
});

// Pairs frames with the calibration target they were recorded for. Frames
// outside every window are training-irrelevant.
/** @implements SPEC-EMOTION-CAPTURE-COMPANION */
export function collectCalibrationSamples(frames, calibrationPoints) {
  const samples = [];
  for (const frame of frames) {
    if (!frame.features) continue;
    const point = calibrationPoints.find((candidate) =>
      frame.sessionMs >= candidate.fromSessionMs && frame.sessionMs <= candidate.toSessionMs);
    if (point) samples.push({ features: frame.features, x: point.x, y: point.y });
  }
  return samples;
}

// frames: [{ sessionMs, features|null }] → gaze samples for the server.
/** @implements SPEC-EMOTION-CAPTURE-COMPANION */
export function mapFramesToGaze(frames, mapping) {
  return frames.map((frame) => {
    if (!frame.features) return { sessionMs: frame.sessionMs, x: 0, y: 0, valid: false };
    const { x, y } = applyMapping(mapping, frame.features);
    // Keep within the server's accepted range; far-off values are still
    // "looked away" rather than garbage.
    return {
      sessionMs: frame.sessionMs,
      x: Number(Math.min(Math.max(x, -2), 3).toFixed(4)),
      y: Number(Math.min(Math.max(y, -2), 3).toFixed(4)),
      valid: true,
    };
  });
}

// One entry point for the estimator: fits on the calibration windows when a
// calibration exists and enough frames landed inside them, else falls back.
/** @implements SPEC-EMOTION-CAPTURE-COMPANION */
export function estimateGaze(frames, calibrationPoints) {
  const samples = calibrationPoints ? collectCalibrationSamples(frames, calibrationPoints) : [];
  const fitted = samples.length >= FEATURE_COUNT ? fitAffineMapping(samples) : null;
  const mapping = fitted || UNCALIBRATED_MAPPING;
  return {
    calibrated: Boolean(fitted),
    fitError: fitted ? Number(fitted.fitError.toFixed(4)) : null,
    calibrationSampleCount: samples.length,
    samples: mapFramesToGaze(frames, mapping),
  };
}
