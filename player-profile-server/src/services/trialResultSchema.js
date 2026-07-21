// Payload-shape validation for Ludellus trial/calibration events.
// The generic /events route stores any object as event_data; this adds a
// targeted schema check so that ludellus.trial_result / ludellus.calibration_result
// events — the raw data the ability engine depends on — are well-formed and do
// not smuggle raw free-text answers (privacy §11). Non-ludellus events are left
// untouched (validate() returns no errors for them).
// See ludellus-tuning-log-design.md §6.1, §6.4, §6.6, §11.

const {
  isTrialResultType,
  isCalibrationType,
  TRIAL_OUTCOMES,
} = require('./trialResult');

// answer_detail must hold only derived quantities (indices, edit distance),
// never raw free-text/voice input (§11). These keys, or any long string value,
// are treated as a raw-text leak and rejected.
const FREE_TEXT_KEYS = ['text', 'raw', 'raw_text', 'input_text', 'answer_text', 'response_text', 'transcript'];
const MAX_ANSWER_STRING_LEN = 64;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

// Push an error when `value` is present (not null/undefined) but fails `predicate`.
function checkOptional(errors, value, predicate, message) {
  if (value === undefined || value === null) return;
  if (!predicate(value)) errors.push(message);
}

function validateEnvelope(errors, data) {
  checkOptional(errors, data.v, (v) => Number.isInteger(v) && v > 0, 'v must be a positive integer');
  checkOptional(errors, data.seq, isNonNegativeInteger, 'seq must be a non-negative integer');
  checkOptional(errors, data.mono_ms, isFiniteNumber, 'mono_ms must be a number');
}

function validateItemSnapshot(errors, snapshot) {
  if (snapshot === undefined || snapshot === null) return;
  if (!isPlainObject(snapshot)) {
    errors.push('item_snapshot must be an object');
    return;
  }
  checkOptional(errors, snapshot.text_len, (v) => isFiniteNumber(v) && v >= 0, 'item_snapshot.text_len must be a non-negative number');
  checkOptional(errors, snapshot.vocab_level, (v) => isFiniteNumber(v) && v >= 0, 'item_snapshot.vocab_level must be a non-negative number');
  checkOptional(errors, snapshot.kanji_ratio, (v) => isFiniteNumber(v) && v >= 0 && v <= 1, 'item_snapshot.kanji_ratio must be between 0 and 1');
  checkOptional(errors, snapshot.difficulty, (v) => isFiniteNumber(v) && v >= 0 && v <= 1, 'item_snapshot.difficulty must be between 0 and 1');
}

function validateAnswerDetail(errors, answerDetail) {
  if (answerDetail === undefined || answerDetail === null) return;
  if (!isPlainObject(answerDetail)) {
    errors.push('answer_detail must be an object');
    return;
  }
  for (const [key, value] of Object.entries(answerDetail)) {
    if (FREE_TEXT_KEYS.includes(key.toLowerCase())) {
      errors.push(`answer_detail.${key} looks like raw free text and must not be stored (§11)`);
      continue;
    }
    if (typeof value === 'string' && value.length > MAX_ANSWER_STRING_LEN) {
      errors.push(`answer_detail.${key} string is too long; store derived values, not raw input (§11)`);
    }
  }
}

// Validate a §6.4 trial_result payload. Returns an array of error strings
// (empty === valid). first_input_ms / response_ms are explicitly nullable
// (timeout / no-input trials).
function validateTrialResult(eventData) {
  const errors = [];
  if (!isPlainObject(eventData)) return ['event_data must be an object'];
  validateEnvelope(errors, eventData);

  if (!isNonEmptyString(eventData.trial_id)) errors.push('trial_id is required');
  if (!isNonEmptyString(eventData.item_id)) errors.push('item_id is required');
  checkOptional(errors, eventData.item_version, (v) => Number.isInteger(v) && v > 0, 'item_version must be a positive integer');
  checkOptional(errors, eventData.trial_index, isNonNegativeInteger, 'trial_index must be a non-negative integer');

  if (!isFiniteNumber(eventData.presented_mono_ms) || eventData.presented_mono_ms < 0) {
    errors.push('presented_mono_ms must be a non-negative number');
  }
  checkOptional(errors, eventData.first_input_ms, (v) => isFiniteNumber(v) && v >= 0, 'first_input_ms must be a non-negative number or null');
  checkOptional(errors, eventData.response_ms, (v) => isFiniteNumber(v) && v >= 0, 'response_ms must be a non-negative number or null');
  checkOptional(errors, eventData.time_limit_ms, (v) => isFiniteNumber(v) && v > 0, 'time_limit_ms must be a positive number');
  checkOptional(errors, eventData.paused_ms, (v) => isFiniteNumber(v) && v >= 0, 'paused_ms must be a non-negative number');
  checkOptional(errors, eventData.input_events, isNonNegativeInteger, 'input_events must be a non-negative integer');
  checkOptional(errors, eventData.corrections, isNonNegativeInteger, 'corrections must be a non-negative integer');
  checkOptional(errors, eventData.rtt_ms, (v) => isFiniteNumber(v) && v >= 0, 'rtt_ms must be a non-negative number');
  checkOptional(errors, eventData.score, (v) => isFiniteNumber(v) && v >= 0 && v <= 1, 'score must be between 0 and 1');

  if (!TRIAL_OUTCOMES.includes(eventData.outcome)) {
    errors.push(`outcome must be one of: ${TRIAL_OUTCOMES.join(', ')}`);
  }

  validateItemSnapshot(errors, eventData.item_snapshot);
  validateAnswerDetail(errors, eventData.answer_detail);
  return errors;
}

// Validate a §6.6 calibration_result payload.
function validateCalibrationResult(eventData) {
  const errors = [];
  if (!isPlainObject(eventData)) return ['event_data must be an object'];
  validateEnvelope(errors, eventData);

  if (!isNonEmptyString(eventData.calibration_type)) {
    errors.push('calibration_type is required');
  }
  if (!Array.isArray(eventData.trials) || eventData.trials.length === 0) {
    errors.push('trials must be a non-empty array');
  } else {
    eventData.trials.forEach((trial, i) => {
      if (!isPlainObject(trial)) {
        errors.push(`trials[${i}] must be an object`);
        return;
      }
      if (!isFiniteNumber(trial.first_input_ms) || trial.first_input_ms < 0) {
        errors.push(`trials[${i}].first_input_ms must be a non-negative number`);
      }
      checkOptional(errors, trial.outcome, (v) => TRIAL_OUTCOMES.includes(v), `trials[${i}].outcome is invalid`);
    });
  }
  return errors;
}

// Dispatch on event_type. Unknown / non-ludellus events pass with no errors so
// existing preference events (level_clear, pvp_match, …) are unaffected.
function validateLudellusEvent(eventType, eventData) {
  if (isTrialResultType(eventType)) return validateTrialResult(eventData);
  if (isCalibrationType(eventType)) return validateCalibrationResult(eventData);
  return [];
}

module.exports = {
  validateTrialResult,
  validateCalibrationResult,
  validateLudellusEvent,
  FREE_TEXT_KEYS,
  MAX_ANSWER_STRING_LEN,
};
