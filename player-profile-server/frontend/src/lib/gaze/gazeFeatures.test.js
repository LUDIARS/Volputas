import test from 'node:test';
import assert from 'node:assert/strict';
import { LANDMARKS, extractGazeFeatures, headPoseProxy } from './gazeFeatures.js';

// Builds a 478-point landmark array where only the indices the extractor reads
// are meaningful. Eye openings are 0.1 wide and 0.04 tall; irises sit at a
// fraction of each opening.
function syntheticFace({ irisRatioX = 0.5, irisRatioY = 0.5, noseX = 0.5, noseY = 0.6, eyeHeight = 0.04 } = {}) {
  const points = Array.from({ length: 478 }, () => ({ x: 0, y: 0, z: 0 }));
  const set = (index, x, y) => { points[index] = { x, y, z: 0 }; };
  // Subject's right eye is on the image left.
  set(LANDMARKS.rightEyeOuter, 0.30, 0.40);
  set(LANDMARKS.rightEyeInner, 0.40, 0.40);
  set(LANDMARKS.rightEyeUpper, 0.35, 0.40 - eyeHeight / 2);
  set(LANDMARKS.rightEyeLower, 0.35, 0.40 + eyeHeight / 2);
  set(LANDMARKS.rightIrisCenter, 0.30 + 0.10 * irisRatioX, 0.40 - eyeHeight / 2 + eyeHeight * irisRatioY);
  set(LANDMARKS.leftEyeInner, 0.60, 0.40);
  set(LANDMARKS.leftEyeOuter, 0.70, 0.40);
  set(LANDMARKS.leftEyeUpper, 0.65, 0.40 - eyeHeight / 2);
  set(LANDMARKS.leftEyeLower, 0.65, 0.40 + eyeHeight / 2);
  set(LANDMARKS.leftIrisCenter, 0.60 + 0.10 * irisRatioX, 0.40 - eyeHeight / 2 + eyeHeight * irisRatioY);
  set(LANDMARKS.noseTip, noseX, noseY);
  set(LANDMARKS.forehead, 0.5, 0.2);
  set(LANDMARKS.chin, 0.5, 0.86);
  set(LANDMARKS.rightCheek, 0.2, 0.55);
  set(LANDMARKS.leftCheek, 0.8, 0.55);
  return points;
}

function near(actual, expected, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} !~ ${expected}`);
}

test('iris position within the eye opening becomes the first two features, in image direction for both eyes', () => {
  const centered = extractGazeFeatures(syntheticFace());
  assert.equal(centered.length, 5);
  near(centered[0], 0.5);
  near(centered[1], 0.5);
  near(centered[4], 1);

  const lookingImageRight = extractGazeFeatures(syntheticFace({ irisRatioX: 0.8, irisRatioY: 0.3 }));
  near(lookingImageRight[0], 0.8);
  near(lookingImageRight[1], 0.3);
});

test('head pose proxies are zero for a frontal face and move with the nose', () => {
  const frontal = headPoseProxy(syntheticFace());
  near(frontal.yaw, 0, 1e-9);
  near(frontal.pitch, (0.4 / 0.66 - 0.6) * 2, 1e-9);
  const turned = headPoseProxy(syntheticFace({ noseX: 0.65 }));
  near(turned.yaw, 0.5, 1e-9);
  const features = extractGazeFeatures(syntheticFace({ noseX: 0.65 }));
  near(features[2], 0.5, 1e-9);
});

test('closed eyes and short landmark arrays yield no features', () => {
  assert.equal(extractGazeFeatures(syntheticFace({ eyeHeight: 0.005 })), null);
  assert.equal(extractGazeFeatures([]), null);
  assert.equal(extractGazeFeatures(null), null);
});
