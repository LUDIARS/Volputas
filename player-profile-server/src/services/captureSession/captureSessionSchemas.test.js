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
