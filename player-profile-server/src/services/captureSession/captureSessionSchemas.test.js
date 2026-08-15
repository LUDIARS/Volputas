const test = require('node:test');
const assert = require('node:assert/strict');
const { EMOTION_STAMPS } = require('../profileEvidenceSchemas');
const {
  MARKER_TYPES,
  MAXIMUM_GAZE_BATCH,
  validateGazeBatchInput,
  validateJoinInput,
  validateMarkerInput,
  validateSignalInput,
  validateStartInput,
} = require('./captureSessionSchemas');

test('marker types are the emotion-curve stamps plus event and note', () => {
  assert.deepEqual([...MARKER_TYPES], [...Object.keys(EMOTION_STAMPS), 'event', 'note']);
});

test('start input requires a game title and accepts a game clock anchor', () => {
  assert.throws(() => validateStartInput({}), /Game title is required/);
  assert.deepEqual(
    validateStartInput({ gameTitle: ' Elden Ring ', gameClockMs: 1500 }),
    { gameTitle: 'Elden Ring', gameClockMs: 1500 }
  );
  assert.equal(validateStartInput({ gameTitle: 'X' }).gameClockMs, null);
});

test('signal input dispatches per action and rejects unknown actions', () => {
  assert.throws(() => validateSignalInput({ action: 'pause' }), /Unknown signal action/);
  assert.equal(validateSignalInput({ action: 'start', gameTitle: 'X' }).action, 'start');
  const marker = validateSignalInput({ action: 'marker', marker: { type: 'event', label: 'boss' } });
  assert.deepEqual(marker, {
    action: 'marker', type: 'event', label: 'boss', sessionMs: null, gameClockMs: null,
  });
  assert.deepEqual(validateSignalInput({ action: 'stop' }), { action: 'stop', gameClockMs: null });
});

test('marker input rejects unknown types', () => {
  assert.throws(() => validateMarkerInput({ type: 'joy' }), /Unknown marker type/);
  assert.equal(validateMarkerInput({ type: 'hype' }).type, 'hype');
});

test('pairing codes are exactly six digits', () => {
  assert.deepEqual(validateJoinInput({ code: '123456' }), { code: '123456' });
  assert.throws(() => validateJoinInput({ code: '12345' }), /exactly 6 digits/);
  assert.throws(() => validateJoinInput({ code: 'abcdef' }), /exactly 6 digits/);
});

test('gaze batches validate every sample and enforce the batch cap', () => {
  assert.throws(() => validateGazeBatchInput({ samples: [] }), /non-empty/);
  assert.throws(
    () => validateGazeBatchInput({
      samples: Array.from({ length: MAXIMUM_GAZE_BATCH + 1 }, () => ({ sessionMs: 0, x: 0, y: 0 })),
    }),
    /at most/
  );
  assert.throws(
    () => validateGazeBatchInput({ samples: [{ sessionMs: -1, x: 0.5, y: 0.5 }] }),
    /sessionMs is out of range/
  );
  assert.throws(
    () => validateGazeBatchInput({ samples: [{ sessionMs: 0, x: 9, y: 0.5 }] }),
    /coordinates are out of range/
  );
  // Slightly off-screen looks (x just outside 0..1) are kept as data.
  const { samples } = validateGazeBatchInput({
    samples: [{ sessionMs: 10.6, x: -0.2, y: 0.5 }, { sessionMs: 20, x: 0.5, y: 0.5, valid: false }],
  });
  assert.deepEqual(samples, [
    { sessionMs: 11, x: -0.2, y: 0.5, valid: true },
    { sessionMs: 20, x: 0.5, y: 0.5, valid: false },
  ]);
});

test('recording uploads must say where they start on the session clock', () => {
  const { validateVideoMetaInput } = require('./captureSessionSchemas');
  assert.throws(() => validateVideoMetaInput({}), /x-capture-start-session-ms header is required/);
  assert.deepEqual(
    validateVideoMetaInput({
      'x-capture-start-session-ms': '1500.4',
      'x-capture-duration-seconds': '61.5',
      'x-capture-width': '1920',
    }),
    { startSessionMs: 1500, durationSeconds: 61.5, width: 1920, height: null }
  );
  assert.throws(() => validateVideoMetaInput({ 'x-capture-start-session-ms': '-1' }), /between 0 and/);
});

test('calibration needs 3..25 in-screen points with ordered session windows', () => {
  const { validateCalibrationInput } = require('./captureSessionSchemas');
  const point = (x, y, from) => ({ x, y, fromSessionMs: from, toSessionMs: from + 1000 });
  assert.throws(() => validateCalibrationInput({ points: [point(0, 0, 0)] }), /between 3 and 25/);
  assert.throws(
    () => validateCalibrationInput({ points: [point(0, 0, 0), point(1.2, 0, 2000), point(1, 1, 4000)] }),
    /within 0..1/
  );
  assert.throws(
    () => validateCalibrationInput({
      points: [point(0, 0, 0), point(1, 0, 2000), { x: 1, y: 1, fromSessionMs: 5000, toSessionMs: 4000 }],
    }),
    /fromSessionMs < toSessionMs/
  );
  const valid = validateCalibrationInput({
    screen: { width: 1920 },
    points: [point(0.1, 0.1, 0), point(0.9, 0.1, 2000.6), point(0.5, 0.9, 4000)],
  });
  assert.equal(valid.points[1].fromSessionMs, 2001);
  assert.deepEqual(valid.screen, { width: 1920, height: null });
});

test('gaze estimation provenance headers are required and typed', () => {
  const { validateGazeEstimationMetaInput } = require('./captureSessionSchemas');
  assert.throws(() => validateGazeEstimationMetaInput({}), /x-gaze-extractor header is required/);
  assert.throws(
    () => validateGazeEstimationMetaInput({ 'x-gaze-extractor': 'mp', 'x-gaze-calibrated': 'yes' }),
    /must be true or false/
  );
  assert.deepEqual(
    validateGazeEstimationMetaInput({
      'x-gaze-extractor': 'mediapipe-face-landmarker+affine-calibration',
      'x-gaze-calibrated': 'false',
      'x-gaze-frame-rate': '15',
    }),
    {
      extractor: 'mediapipe-face-landmarker+affine-calibration',
      calibrated: false,
      fitError: null,
      frameRate: 15,
    }
  );
});
