// Shared interpretation of Ludellus trial/calibration events.
// Single source of truth for event-type names and for turning a raw §6.4
// `event_data` payload into a normalised, analysis-ready shape. Consumed by the
// abilityEngine (§8), content-stats calibration (§7.2) and the play-session
// timeline aggregator so they all read trial_result the same way.
// See ludellus-tuning-log-design.md §6.

const EVENT_NAMESPACE = 'ludellus';
const TRIAL_RESULT_EVENT_TYPE = 'ludellus.trial_result';
const CALIBRATION_EVENT_TYPE = 'ludellus.calibration_result';

// Outcome enum for a single trial (§6.4).
const TRIAL_OUTCOMES = ['correct', 'wrong', 'timeout', 'abandoned'];

// Event types are namespaced `ludellus.*` (§6). Older instrumentation (and the
// original play-session timeline) emitted the bare name, so both are accepted.
function isTrialResultType(eventType) {
  return eventType === TRIAL_RESULT_EVENT_TYPE || eventType === 'trial_result';
}

function isCalibrationType(eventType) {
  return eventType === CALIBRATION_EVENT_TYPE || eventType === 'calibration_result';
}

// A trial is "correct" when its §6.4 outcome is `correct`. The legacy timeline
// payload used a boolean `correct`, kept here for backward compatibility.
function isCorrectOutcome(eventData) {
  if (!eventData || typeof eventData !== 'object') return false;
  if (eventData.outcome !== undefined) return eventData.outcome === 'correct';
  return eventData.correct === true;
}

function finiteOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Normalise a raw trial_result `event_data` into the canonical fields the
// analytics services rely on. Missing/invalid numerics become null rather than
// NaN so downstream filters (§8.2) can exclude them cleanly.
function extractTrial(eventData) {
  const data = eventData && typeof eventData === 'object' ? eventData : {};
  const snapshot = data.item_snapshot && typeof data.item_snapshot === 'object'
    ? data.item_snapshot
    : {};
  const outcome = TRIAL_OUTCOMES.includes(data.outcome) ? data.outcome : null;
  return {
    itemId: typeof data.item_id === 'string' ? data.item_id : null,
    itemVersion: Number.isInteger(data.item_version) ? data.item_version : null,
    outcome,
    correct: isCorrectOutcome(data),
    isTimeout: outcome === 'timeout',
    score: finiteOrNull(data.score),
    presentedMonoMs: finiteOrNull(data.presented_mono_ms),
    firstInputMs: finiteOrNull(data.first_input_ms),
    responseMs: finiteOrNull(data.response_ms),
    pausedMs: finiteOrNull(data.paused_ms) ?? 0,
    rttMs: finiteOrNull(data.rtt_ms),
    inputEvents: finiteOrNull(data.input_events),
    corrections: finiteOrNull(data.corrections) ?? finiteOrNull(data.retries),
    // item_snapshot difficulty attributes (§7.1) — used for level/category curves.
    textLen: finiteOrNull(snapshot.text_len),
    vocabLevel: Number.isInteger(snapshot.vocab_level) ? snapshot.vocab_level : finiteOrNull(snapshot.vocab_level),
    kanjiRatio: finiteOrNull(snapshot.kanji_ratio),
    category: typeof snapshot.category === 'string' ? snapshot.category : null,
    difficulty: finiteOrNull(snapshot.difficulty),
  };
}

module.exports = {
  EVENT_NAMESPACE,
  TRIAL_RESULT_EVENT_TYPE,
  CALIBRATION_EVENT_TYPE,
  TRIAL_OUTCOMES,
  isTrialResultType,
  isCalibrationType,
  isCorrectOutcome,
  extractTrial,
};
