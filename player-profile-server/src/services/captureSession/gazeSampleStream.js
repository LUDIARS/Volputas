// Streams an NDJSON gaze upload (post-hoc estimation) into validated samples
// without buffering the whole body: an hour of 30 Hz samples is ~100k lines,
// and the same validation the companion batch endpoint applies runs per line.
const { validateGazeSample } = require('./captureSessionSchemas');

const MAXIMUM_SAMPLES = 1_000_000;
const MAXIMUM_LINE_BYTES = 512;

function invalidInput(message) {
  return Object.assign(new Error(message), { code: 'INVALID_CAPTURE_INPUT', statusCode: 400 });
}

/** @implements SPEC-EMOTION-CAPTURE-COMPANION */
async function* parseGazeSampleLines(stream, { maximumSamples = MAXIMUM_SAMPLES } = {}) {
  let pending = '';
  let count = 0;
  const emit = function* (line, lineNumber) {
    if (line.trim().length === 0) return;
    if (line.length > MAXIMUM_LINE_BYTES) {
      throw invalidInput(`Gaze sample line ${lineNumber} is too long`);
    }
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw invalidInput(`Gaze sample line ${lineNumber} is not valid JSON`);
    }
    count += 1;
    if (count > maximumSamples) {
      throw invalidInput(`Gaze upload exceeds ${maximumSamples} samples`);
    }
    yield validateGazeSample(parsed);
  };
  let lineNumber = 0;
  for await (const chunk of stream) {
    pending += chunk.toString('utf8');
    // Guard against a body with no newlines at all growing without bound.
    if (pending.length > MAXIMUM_LINE_BYTES * 4 && !pending.includes('\n')) {
      throw invalidInput('Gaze upload must be newline-delimited JSON');
    }
    let newline = pending.indexOf('\n');
    while (newline !== -1) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      lineNumber += 1;
      yield* emit(line, lineNumber);
      newline = pending.indexOf('\n');
    }
  }
  if (pending.length > 0) {
    lineNumber += 1;
    yield* emit(pending, lineNumber);
  }
}

module.exports = { MAXIMUM_LINE_BYTES, MAXIMUM_SAMPLES, parseGazeSampleLines };
