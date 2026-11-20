const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlayStreamRecorder, MAX_EVENTS_PER_SESSION } = require('./playStreamRecorder');
const { parsePlayStreamFrame } = require('./playStreamFrames');
const { createMemoryPlayStreamStore } = require('./memoryPlayStreamStore.testHelper');
const { SESSION_ID, USER, startFrame, trialFrame, metricFrame, endFrame } = require('./playStreamFrames.testHelper');

const OTHER = '99999999-9999-4999-8999-999999999999';

function frame(value) {
  const parsed = parsePlayStreamFrame(JSON.stringify(value));
  assert.equal(parsed.ok, true, parsed.detail);
  return parsed.frame;
}

function setup() {
  const store = createMemoryPlayStreamStore();
  const jobs = [];
  const recorder = createPlayStreamRecorder({ store, runPostSessionJobs: async (session) => { jobs.push(session.id); } });
  return { store, recorder, jobs };
}

test('stores a session, acks every frame, summarizes on end and runs the session jobs (SPEC-VO-PLAY-STREAM-IDEMPOTENT)', async () => {
  const { store, recorder, jobs } = setup();
  assert.deepEqual(await recorder.handle(USER, frame(startFrame())), { type: 'ack', sessionId: SESSION_ID, seq: 0 });
  await recorder.handle(USER, frame(trialFrame(1, { outcome: 'wrong', response_ms: 2000 })));
  await recorder.handle(USER, frame(trialFrame(2, { attempt: 2, since_wrong_ms: 700 })));
  await recorder.handle(USER, frame(metricFrame(3, 'hint.used', 1)));
  assert.deepEqual(await recorder.handle(USER, frame(endFrame(4))), { type: 'ack', sessionId: SESSION_ID, seq: 4 });
  const session = await store.findSession(SESSION_ID);
  assert.equal(session.ended_at.toISOString(), '2026-11-21T10:05:00.000Z');
  assert.equal(session.metadata.mode, 'solo');
  const summary = store.events.find((event) => event.event_type === 'ludellus.session_summary').event_data;
  assert.equal(summary.items, 1);
  assert.equal(summary.first_try_accuracy, 0);
  assert.equal(summary.since_wrong_ms_median, 700);
  assert.equal(summary.duration_ms, 300_000);
  assert.deepEqual(jobs, [SESSION_ID]);
});

test('acks resends without storing twice, including after the end', async () => {
  const { store, recorder } = setup();
  await recorder.handle(USER, frame(startFrame()));
  await recorder.handle(USER, frame(trialFrame(1)));
  assert.deepEqual(await recorder.handle(USER, frame(trialFrame(1, { outcome: 'wrong' }))), { type: 'ack', sessionId: SESSION_ID, seq: 1 });
  assert.equal(await store.countEvents(SESSION_ID), 1);
  assert.equal((await recorder.handle(USER, frame(startFrame()))).type, 'ack');
  await recorder.handle(USER, frame(endFrame(2)));
  assert.equal((await recorder.handle(USER, frame(trialFrame(1)))).type, 'ack');
  assert.equal((await recorder.handle(USER, frame(endFrame(2)))).type, 'ack');
  assert.equal((await recorder.handle(USER, frame(trialFrame(3)))).code, 'session_ended');
  assert.equal(store.events.filter((event) => event.event_type === 'ludellus.session_summary').length, 1);
});

test('refuses unknown and foreign sessions and an end before the start', async () => {
  const { recorder } = setup();
  assert.equal((await recorder.handle(USER, frame(trialFrame(1)))).code, 'unknown_session');
  await recorder.handle(USER, frame(startFrame()));
  assert.equal((await recorder.handle(OTHER, frame(trialFrame(1)))).code, 'forbidden');
  assert.equal((await recorder.handle(OTHER, frame(startFrame()))).code, 'forbidden');
  assert.equal((await recorder.handle(USER, frame(endFrame(1, { endedAt: '2026-11-21T09:00:00.000Z' })))).code, 'invalid_frame');
});

test('stops storing at the per-session limit', async () => {
  const { store, recorder } = setup();
  await recorder.handle(USER, frame(startFrame()));
  for (let seq = 1; seq <= MAX_EVENTS_PER_SESSION; seq += 1) {
    store.events.push({ session_id: SESSION_ID, event_type: 'ludellus.metric', event_data: { seq } });
  }
  assert.equal((await recorder.handle(USER, frame(metricFrame(MAX_EVENTS_PER_SESSION + 1, 'n', 1)))).code, 'limit');
});
