const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isTrialResultType,
  isCalibrationType,
  isCorrectOutcome,
  extractTrial,
} = require('./trialResult');

test('event-type predicates accept namespaced and legacy bare names', () => {
  assert.equal(isTrialResultType('ludellus.trial_result'), true);
  assert.equal(isTrialResultType('trial_result'), true);
  assert.equal(isTrialResultType('ludellus.round_result'), false);
  assert.equal(isCalibrationType('ludellus.calibration_result'), true);
  assert.equal(isCalibrationType('calibration_result'), true);
  assert.equal(isCalibrationType('trial_result'), false);
});

test('isCorrectOutcome reads §6.4 outcome and the legacy boolean', () => {
  assert.equal(isCorrectOutcome({ outcome: 'correct' }), true);
  assert.equal(isCorrectOutcome({ outcome: 'wrong' }), false);
  assert.equal(isCorrectOutcome({ outcome: 'timeout' }), false);
  assert.equal(isCorrectOutcome({ correct: true }), true);
  assert.equal(isCorrectOutcome({}), false);
  assert.equal(isCorrectOutcome(null), false);
});

test('extractTrial normalises a full §6.4 payload', () => {
  const trial = extractTrial({
    trial_id: 'b2a1', trial_index: 7,
    item_id: 'vocab_ja_00123', item_version: 3,
    item_snapshot: { task_type: 'word_match', lang: 'ja', text_len: 24, vocab_level: 4, kanji_ratio: 0.35, difficulty: 0.62, category: 'science' },
    presented_mono_ms: 1230000, first_input_ms: 480, response_ms: 2350, time_limit_ms: 8000, paused_ms: 0,
    input_events: 5, corrections: 1,
    outcome: 'correct', score: 1.0, answer_detail: { chosen_idx: 2, expected_idx: 2 }, rtt_ms: 42,
  });
  assert.equal(trial.itemId, 'vocab_ja_00123');
  assert.equal(trial.itemVersion, 3);
  assert.equal(trial.outcome, 'correct');
  assert.equal(trial.correct, true);
  assert.equal(trial.isTimeout, false);
  assert.equal(trial.firstInputMs, 480);
  assert.equal(trial.responseMs, 2350);
  assert.equal(trial.pausedMs, 0);
  assert.equal(trial.rttMs, 42);
  assert.equal(trial.corrections, 1);
  assert.equal(trial.textLen, 24);
  assert.equal(trial.vocabLevel, 4);
  assert.equal(trial.kanjiRatio, 0.35);
  assert.equal(trial.category, 'science');
  assert.equal(trial.difficulty, 0.62);
});

test('extractTrial is defensive: nulls for missing, corrections falls back to retries', () => {
  const trial = extractTrial({ correct: true, retries: 2, item_snapshot: 'not-an-object' });
  assert.equal(trial.itemId, null);
  assert.equal(trial.itemVersion, null);
  assert.equal(trial.outcome, null);
  assert.equal(trial.correct, true);
  assert.equal(trial.isTimeout, false);
  assert.equal(trial.firstInputMs, null);
  assert.equal(trial.pausedMs, 0);
  assert.equal(trial.corrections, 2);
  assert.equal(trial.textLen, null);
  assert.equal(trial.category, null);
});

test('extractTrial marks timeouts', () => {
  const trial = extractTrial({ item_id: 'i', item_version: 1, outcome: 'timeout', first_input_ms: null, response_ms: null });
  assert.equal(trial.isTimeout, true);
  assert.equal(trial.correct, false);
});
