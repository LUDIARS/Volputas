const test = require('node:test');
const assert = require('node:assert/strict');
const { closeIdlePlaySessions, IDLE_CLOSE_AFTER_MS } = require('./playStreamIdleCloser');
const { createPlayStreamRecorder } = require('./playStreamRecorder');
const { parsePlayStreamFrame } = require('./playStreamFrames');
const { createMemoryPlayStreamStore } = require('./memoryPlayStreamStore.testHelper');
const { SESSION_ID, USER, startFrame, metricFrame, endFrame } = require('./playStreamFrames.testHelper');
const { SESSION_SUMMARY_EVENT_TYPE } = require('../services/trialResult');

const MINUTE = 60_000;

function frame(value) {
  const parsed = parsePlayStreamFrame(JSON.stringify(value));
  assert.equal(parsed.ok, true, parsed.detail);
  return parsed.frame;
}

/** 時計を進められる保存先と記録器。開始は startFrame の startedAt。 */
function setup() {
  let clock = 0;
  const store = createMemoryPlayStreamStore({ now: () => new Date(clock) });
  const recorder = createPlayStreamRecorder({ store });
  const jobs = [];
  const runPostSessionJobs = async (session) => { jobs.push(session.id); };
  return {
    store,
    recorder,
    jobs,
    at: (ms) => { clock = ms; },
    close: (nowMs) => closeIdlePlaySessions({ store, runPostSessionJobs, now: () => nowMs }),
  };
}

function summaryOf(store, sessionId = SESSION_ID) {
  return store.events.find((event) => event.session_id === sessionId && event.event_type === SESSION_SUMMARY_EVENT_TYPE)?.event_data;
}

test('closes a session whose end never arrived at its last record, as abandoned by idle (SPEC-VO-PLAY-STREAM-IDLE-CLOSE)', async () => {
  const { store, recorder, jobs, at, close } = setup();
  const start = frame(startFrame());
  const startedAt = new Date(start.startedAt).getTime();
  await recorder.handle(USER, start);
  at(startedAt + 1 * MINUTE);
  await recorder.handle(USER, frame(metricFrame(1, 'play.active_ms', 60_000)));
  at(startedAt + 30 * MINUTE);
  await recorder.handle(USER, frame(metricFrame(2, 'play.active_ms', 60_000)));

  // 最後の記録から 15 分経つまでは締めない (まだ遊んでいるかもしれない)。
  assert.equal(await close(startedAt + 30 * MINUTE + IDLE_CLOSE_AFTER_MS - 1), 0);
  assert.equal(await close(startedAt + 30 * MINUTE + IDLE_CLOSE_AFTER_MS + 1), 1);

  const session = await store.findSession(SESSION_ID);
  assert.equal(session.ended_at.getTime(), startedAt + 30 * MINUTE);
  const summary = summaryOf(store);
  assert.equal(summary.reason, 'abandoned');
  assert.equal(summary.closed_by, 'idle');
  assert.equal(summary.duration_ms, 30 * MINUTE);
  assert.equal(summary.metrics['play.active_ms'].sum, 120_000);
  assert.deepEqual(jobs, [SESSION_ID]);

  // 締めた回は統計に入る。
  const rows = await store.listSummaries({ userId: USER });
  assert.equal(rows.length, 1);
  // 二度は締めない。
  assert.equal(await close(startedAt + 120 * MINUTE), 0);
});

test('a late session_end after the idle close is acked without a second summary', async () => {
  const { store, recorder, at, close } = setup();
  const start = frame(startFrame());
  const startedAt = new Date(start.startedAt).getTime();
  await recorder.handle(USER, start);
  at(startedAt + 5 * MINUTE);
  await recorder.handle(USER, frame(metricFrame(1, 'input.count', 3)));
  assert.equal(await close(startedAt + 60 * MINUTE), 1);
  assert.deepEqual(await recorder.handle(USER, frame(endFrame(2))), { type: 'ack', sessionId: SESSION_ID, seq: 2 });
  assert.equal(store.events.filter((event) => event.event_type === SESSION_SUMMARY_EVENT_TYPE).length, 1);
});

test('leaves sessions that ended normally alone', async () => {
  const { store, recorder, close } = setup();
  const start = frame(startFrame());
  await recorder.handle(USER, start);
  await recorder.handle(USER, frame(endFrame(1)));
  assert.equal(await close(new Date(start.startedAt).getTime() + 120 * MINUTE), 0);
  assert.equal(store.events.filter((event) => event.event_type === SESSION_SUMMARY_EVENT_TYPE).length, 1);
});

test('rescues a session the Spectator cleanup ended without a summary', async () => {
  const { store, recorder, at, close } = setup();
  const start = frame(startFrame());
  const startedAt = new Date(start.startedAt).getTime();
  await recorder.handle(USER, start);
  at(startedAt + 20 * MINUTE);
  await recorder.handle(USER, frame(metricFrame(1, 'input.count', 40)));
  // 旧 closeStale は ended_at = started_at で閉じ、集計を作らなかった。
  store.sessions.get(SESSION_ID).ended_at = new Date(startedAt);
  assert.equal(await close(startedAt + 48 * 60 * MINUTE), 1);
  assert.equal((await store.findSession(SESSION_ID)).ended_at.getTime(), startedAt + 20 * MINUTE);
  assert.equal(summaryOf(store).duration_ms, 20 * MINUTE);
});

test('skips a session whose end arrived after it was listed', async () => {
  const { store, recorder, close } = setup();
  const start = frame(startFrame());
  await recorder.handle(USER, start);
  const [candidate] = await store.listUnsummarizedSessions({ idleBefore: new Date(Date.parse(start.startedAt) + 60 * MINUTE) });
  await recorder.handle(USER, frame(endFrame(1)));
  assert.equal(await store.closeIdleSession({ id: candidate.id, seenEndedAt: candidate.ended_at, endedAt: new Date(), summary: {} }), null);
  assert.equal(await close(Date.parse(start.startedAt) + 60 * MINUTE), 0);
});
