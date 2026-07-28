const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateTrialResult,
  validateCalibrationResult,
  validateLudellusEvent,
} = require('./trialResultSchema');

const validTrial = {
  v: 1, seq: 42,
  trial_id: 't1', trial_index: 0,
  item_id: 'vocab_ja_00123', item_version: 3,
  item_snapshot: { text_len: 24, vocab_level: 4, kanji_ratio: 0.35, difficulty: 0.62 },
  presented_mono_ms: 1230000, first_input_ms: 480, response_ms: 2350, paused_ms: 0,
  input_events: 5, corrections: 1,
  outcome: 'correct', score: 1.0, answer_detail: { chosen_idx: 2, expected_idx: 2 }, rtt_ms: 42,
};

test('validateTrialResult accepts a well-formed payload', () => {
  assert.deepEqual(validateTrialResult(validTrial), []);
});

test('validateTrialResult allows null timings for a timeout', () => {
  assert.deepEqual(validateTrialResult({
    trial_id: 't1', item_id: 'i1', presented_mono_ms: 1000,
    outcome: 'timeout', first_input_ms: null, response_ms: null,
  }), []);
});

test('validateTrialResult flags missing required fields and bad outcome', () => {
  const errors = validateTrialResult({ presented_mono_ms: -5, outcome: 'nope' });
  assert.ok(errors.some((e) => e.includes('trial_id')));
  assert.ok(errors.some((e) => e.includes('item_id')));
  assert.ok(errors.some((e) => e.includes('presented_mono_ms')));
  assert.ok(errors.some((e) => e.includes('outcome')));
});

test('validateTrialResult rejects out-of-range score and bad snapshot', () => {
  assert.ok(validateTrialResult({ ...validTrial, score: 2 }).some((e) => e.includes('score')));
  assert.ok(validateTrialResult({ ...validTrial, item_snapshot: { kanji_ratio: 5 } })
    .some((e) => e.includes('kanji_ratio')));
});

test('validateTrialResult blocks raw free text in answer_detail (§11)', () => {
  assert.ok(validateTrialResult({ ...validTrial, answer_detail: { raw_text: 'my private answer' } })
    .some((e) => e.includes('answer_detail')));
  assert.ok(validateTrialResult({ ...validTrial, answer_detail: { note: 'x'.repeat(100) } })
    .some((e) => e.includes('answer_detail')));
  // derived-only detail is fine
  assert.deepEqual(validateTrialResult({ ...validTrial, answer_detail: { edit_distance: 3, chosen_idx: 1 } }), []);
});

test('validateCalibrationResult requires a non-empty trials array', () => {
  assert.deepEqual(validateCalibrationResult({
    calibration_type: 'visual_simple',
    trials: [{ first_input_ms: 285, outcome: 'correct' }, { first_input_ms: 310 }],
  }), []);
  assert.ok(validateCalibrationResult({ calibration_type: 'visual_simple', trials: [] })
    .some((e) => e.includes('trials')));
  assert.ok(validateCalibrationResult({ trials: [{ first_input_ms: -1 }] })
    .some((e) => e.includes('first_input_ms')));
});

test('validateLudellusEvent dispatches by type and ignores non-ludellus events', () => {
  assert.deepEqual(validateLudellusEvent('level_clear', { anything: true }), []);
  assert.deepEqual(validateLudellusEvent('ludellus.trial_result', validTrial), []);
  assert.ok(validateLudellusEvent('ludellus.trial_result', { outcome: 'x' }).length > 0);
});
