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

// Screen / face recordings arrive as raw streams; their placement on the
// session clock travels in headers. startSessionMs is mandatory: a recording
// that cannot be anchored cannot be replayed against gaze, markers or speech.
function validateVideoMetaInput(headers = {}) {
  const startSessionMs = optionalNumber(
    headers['x-capture-start-session-ms'], 0, MAXIMUM_SESSION_MS, 'x-capture-start-session-ms'
  );
  if (startSessionMs === null) {
    throw invalidInput('x-capture-start-session-ms header is required for recordings');
  }
  return {
    startSessionMs: Math.round(startSessionMs),
    durationSeconds: optionalNumber(
      headers['x-capture-duration-seconds'], 0, 24 * 3600, 'x-capture-duration-seconds'
    ),
    width: optionalNumber(headers['x-capture-width'], 1, 16384, 'x-capture-width'),
    height: optionalNumber(headers['x-capture-height'], 1, 16384, 'x-capture-height'),
  };
}

// Gaze calibration: while the face camera records, the desktop UI shows target
// dots one after another; each point is the screen position (normalized) and
// the session-clock window during which the player looked at it. Post-hoc gaze
// estimation fits its screen mapping on exactly these windows.
const MINIMUM_CALIBRATION_POINTS = 3;
const MAXIMUM_CALIBRATION_POINTS = 25;

function validateCalibrationPoint(point = {}) {
  const x = Number(point.x);
  const y = Number(point.y);
  if (!Number.isFinite(x) || x < 0 || x > 1 || !Number.isFinite(y) || y < 0 || y > 1) {
    throw invalidInput('Calibration point coordinates must be within 0..1');
  }
  const fromSessionMs = Number(point.fromSessionMs);
  const toSessionMs = Number(point.toSessionMs);
  if (!Number.isFinite(fromSessionMs) || fromSessionMs < 0 || fromSessionMs > MAXIMUM_SESSION_MS
    || !Number.isFinite(toSessionMs) || toSessionMs <= fromSessionMs || toSessionMs > MAXIMUM_SESSION_MS) {
    throw invalidInput('Calibration point needs fromSessionMs < toSessionMs on the session clock');
  }
  return { x, y, fromSessionMs: Math.round(fromSessionMs), toSessionMs: Math.round(toSessionMs) };
}

function validateCalibrationInput(body = {}) {
  if (!Array.isArray(body.points)) throw invalidInput('points must be an array');
  if (body.points.length < MINIMUM_CALIBRATION_POINTS || body.points.length > MAXIMUM_CALIBRATION_POINTS) {
    throw invalidInput(
      `points must contain between ${MINIMUM_CALIBRATION_POINTS} and ${MAXIMUM_CALIBRATION_POINTS} entries`
    );
  }
  return {
    points: body.points.map(validateCalibrationPoint),
    screen: {
      width: optionalNumber(body.screen?.width, 1, 16384, 'screen.width'),
      height: optionalNumber(body.screen?.height, 1, 16384, 'screen.height'),
    },
  };
}

// Post-hoc gaze estimation streams its samples as NDJSON; the provenance of the
// estimator travels in headers so the record can say how the samples were made.
function validateGazeEstimationMetaInput(headers = {}) {
  const extractor = optionalText(headers['x-gaze-extractor'], 120);
  if (!extractor) throw invalidInput('x-gaze-extractor header is required');
  const calibratedRaw = headers['x-gaze-calibrated'];
  if (calibratedRaw !== 'true' && calibratedRaw !== 'false') {
    throw invalidInput('x-gaze-calibrated header must be true or false');
  }
  return {
    extractor,
    calibrated: calibratedRaw === 'true',
    fitError: optionalNumber(headers['x-gaze-fit-error'], 0, 10, 'x-gaze-fit-error'),
    frameRate: optionalNumber(headers['x-gaze-frame-rate'], 0.1, 240, 'x-gaze-frame-rate'),
  };
}

function validateAudioMetaInput(headers = {}) {
  return {
    durationSeconds: optionalNumber(
      headers['x-audio-duration-seconds'], 0, 24 * 3600, 'x-audio-duration-seconds'
    ),
    startSessionMs: optionalNumber(
      headers['x-audio-start-session-ms'], 0, MAXIMUM_SESSION_MS, 'x-audio-start-session-ms'
    ),
  };
}

module.exports = {
  MAXIMUM_CALIBRATION_POINTS,
  MINIMUM_CALIBRATION_POINTS,
  MARKER_ORIGINS,
  MARKER_TYPES,
  MAXIMUM_GAZE_BATCH,
  MAXIMUM_SESSION_MS,
  SIGNAL_ACTIONS,
  validateAudioMetaInput,
  validateCalibrationInput,
  validateGazeBatchInput,
  validateGazeEstimationMetaInput,
  validateGazeSample,
  validateJoinInput,
  validateMarkerInput,
  validateSignalInput,
  validateStartInput,
  validateSyncInput,
  validateVideoMetaInput,
};
