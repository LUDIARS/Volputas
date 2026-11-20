const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePlayStreamFrame } = require('./playStreamFrames');
const { SESSION_ID, startFrame, trialFrame, metricFrame, endFrame } = require('./playStreamFrames.testHelper');

const parse = (value) => parsePlayStreamFrame(JSON.stringify(value));

test('accepts start, trial, metric and end frames (SPEC-VO-PLAY-STREAM-FRAMES)', () => {
  assert.equal(parse(startFrame()).ok, true);
  assert.equal(parse(trialFrame(1, { outcome: 'wrong' })).ok, true);
  assert.equal(parse(trialFrame(2, { attempt: 2, since_wrong_ms: 600 })).ok, true);
  assert.equal(parse(metricFrame(3, 'combo.max', 4)).ok, true);
  assert.equal(parse(endFrame(4, { reason: 'abandoned' })).ok, true);
});

test('rejects unknown fields and echoes the ids it could read', () => {
  assert.deepEqual(parse({ ...endFrame(5), extra: true }), { ok: false, sessionId: SESSION_ID, seq: 5 });
  assert.equal(parse(startFrame({ metadata: { Bad: 1 } })).ok, false);
});

test('requires event_data.seq to match the frame seq', () => {
  const frame = trialFrame(2);
  frame.eventData.seq = 3;
  const result = parse(frame);
  assert.equal(result.ok, false);
  assert.match(result.detail, /event_data\.seq/);
});

test('runs the existing ludellus.* checks on event_data', () => {
  assert.equal(parse(trialFrame(1, { answer_detail: { transcript: 'りんご' } })).ok, false);
  assert.equal(parse(trialFrame(1, { since_wrong_ms: 100 })).ok, false);
  assert.equal(parse(metricFrame(1, 'Bad Name', 1)).ok, false);
  assert.equal(parse({ ...metricFrame(1, 'ok', 1), eventType: 'ludellus.round_result' }).ok, false);
});

test('rejects broken JSON and bad session ids', () => {
  assert.deepEqual(parsePlayStreamFrame('{'), { ok: false });
  assert.equal(parse(startFrame({ sessionId: 'not-a-uuid' })).ok, false);
  assert.equal(parse(startFrame({ seq: 1 })).ok, false);
});
