// Validation contract for the emotion-capture companion
// (spec/feature/emotion-capture-companion.md). Follows the same throw-on-invalid
// idiom as profileEvidenceSchemas so route handlers stay thin.
const { EMOTION_STAMPS } = require('../profileEvidenceSchemas');

// One-tap marker types share ids with the emotion-curve stamps so a mid-play tap
// and an after-play curve entry speak the same vocabulary; `event` and `note`
// carry game milestones and free-form remarks.
const MARKER_TYPES = Object.freeze([...Object.keys(EMOTION_STAMPS), 'event', 'note']);
const MARKER_ORIGINS = Object.freeze(['game', 'companion', 'desktop']);
const SIGNAL_ACTIONS = Object.freeze(['start', 'stop', 'marker']);

const MAXIMUM_GAZE_BATCH = 2000;
// A session clock value far beyond 24h is a sync bug, not a play session.
const MAXIMUM_SESSION_MS = 24 * 60 * 60 * 1000;

function invalidInput(message) {
  return Object.assign(new Error(message), { code: 'INVALID_CAPTURE_INPUT' });
}

function requiredText(value, label, maximum = 200) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw invalidInput(`${label} is required`);
  if (normalized.length > maximum) throw invalidInput(`${label} is too long`);
  return normalized;
}

function optionalText(value, maximum = 200) {
  if (value === undefined || value === null) return '';
  const normalized = String(value).trim();
  if (normalized.length > maximum) throw invalidInput('Text input is too long');
  return normalized;
}

function optionalNumber(value, minimum, maximum, label) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw invalidInput(`${label} must be between ${minimum} and ${maximum}`);
  }
  return number;
}

function validateStartInput(body = {}) {
  return {
    gameTitle: requiredText(body.gameTitle, 'Game title'),
    gameClockMs: optionalNumber(body.gameClockMs, 0, MAXIMUM_SESSION_MS, 'gameClockMs'),
  };
}

function validateMarkerInput(body = {}) {
  const type = String(body.type || '');
  if (!MARKER_TYPES.includes(type)) {
    throw invalidInput(`Unknown marker type: ${type || '(empty)'}`);
  }
  return {
    type,
    label: optionalText(body.label, 120),
    sessionMs: optionalNumber(body.sessionMs, 0, MAXIMUM_SESSION_MS, 'sessionMs'),
    gameClockMs: optionalNumber(body.gameClockMs, 0, MAXIMUM_SESSION_MS, 'gameClockMs'),
  };
}

// The game-facing signal is one endpoint on purpose: a game integration wires a
// single URL and switches `action`, instead of learning the session lifecycle.
function validateSignalInput(body = {}) {
  const action = String(body.action || '');
  if (!SIGNAL_ACTIONS.includes(action)) {
    throw invalidInput(`Unknown signal action: ${action || '(empty)'}`);
  }
  if (action === 'start') return { action, ...validateStartInput(body) };
  if (action === 'marker') return { action, ...validateMarkerInput(body.marker || {}) };
  return { action, gameClockMs: optionalNumber(body.gameClockMs, 0, MAXIMUM_SESSION_MS, 'gameClockMs') };
}

function validateGazeSample(sample = {}) {
  const sessionMs = Number(sample.sessionMs);
  if (!Number.isFinite(sessionMs) || sessionMs < 0 || sessionMs > MAXIMUM_SESSION_MS) {
    throw invalidInput('Gaze sample sessionMs is out of range');
  }
  // Slightly out-of-screen coordinates are real data (the player looked away),
  // so the accepted range is wider than 0..1; the timeline aggregation counts
  // anything outside 0..1 as off-screen.
  const x = Number(sample.x);
  const y = Number(sample.y);
  if (!Number.isFinite(x) || x < -2 || x > 3 || !Number.isFinite(y) || y < -2 || y > 3) {
    throw invalidInput('Gaze sample coordinates are out of range');
  }
  const valid = sample.valid === undefined ? true : sample.valid;
  if (typeof valid !== 'boolean') throw invalidInput('Gaze sample valid must be a boolean');
  return { sessionMs: Math.round(sessionMs), x, y, valid };
}

function validateGazeBatchInput(body = {}) {
  if (!Array.isArray(body.samples) || body.samples.length === 0) {
    throw invalidInput('samples must be a non-empty array');
  }
  if (body.samples.length > MAXIMUM_GAZE_BATCH) {
    throw invalidInput(`samples must contain at most ${MAXIMUM_GAZE_BATCH} entries`);
  }
  return { samples: body.samples.map(validateGazeSample) };
}

function validateJoinInput(body = {}) {
  const code = requiredText(body.code, 'Pairing code', 6);
  if (!/^\d{6}$/.test(code)) {
    throw invalidInput('Pairing code must contain exactly 6 digits');
  }
  return { code };
}

function validateSyncInput(body = {}) {
  return {
    clientSentAtMs: optionalNumber(
      body.clientSentAtMs, 0, Number.MAX_SAFE_INTEGER, 'clientSentAtMs'
    ),
  };
}

function validateAudioMetaInput(headers = {}) {
  return {
    durationSeconds: optionalNumber(
      headers['x-audio-duration-seconds'], 0, 24 * 3600, 'x-audio-duration-seconds'
    ),
  };
}

module.exports = {
  MARKER_ORIGINS,
  MARKER_TYPES,
  MAXIMUM_GAZE_BATCH,
  MAXIMUM_SESSION_MS,
  SIGNAL_ACTIONS,
  validateAudioMetaInput,
  validateGazeBatchInput,
  validateJoinInput,
  validateMarkerInput,
  validateSignalInput,
  validateStartInput,
  validateSyncInput,
};
