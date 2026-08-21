import test from 'node:test';
import assert from 'node:assert/strict';
import { MarkerDispatcher } from './markerDispatcher.js';
import { MarkerQueue } from './markerQueue.js';

function fixture({ fail = false } = {}) {
  const sent = [];
  let clock = 1000;
  const dispatcher = new MarkerDispatcher({
    queue: new MarkerQueue({ now: () => clock }),
    now: () => clock,
    postMarker: async (marker) => {
      if (fail) throw Object.assign(new Error('offline'), { code: 'LOCAL_APP_UNREACHABLE' });
      sent.push(marker);
    },
  });
  return { dispatcher, sent, tick: (ms) => { clock += ms; }, at: () => clock };
}

test('with no local app the drop is buffered, never dropped', async () => {
  const { dispatcher } = fixture();
  const result = await dispatcher.drop({ type: 'hype' });
  assert.deepEqual(result, { outcome: 'buffered', reason: 'local-app-unreachable', pending: 1 });
  assert.equal(dispatcher.state().reachable, false);
});

test('reachable but not recording still buffers, with a distinguishable reason', async () => {
  const { dispatcher } = fixture();
  await dispatcher.updateStatus({ reachable: true, captureSession: null });
  const result = await dispatcher.drop({ type: 'like', label: '演出' });
  assert.equal(result.reason, 'no-active-session');
  assert.equal(dispatcher.pendingCount, 1);
});

test('buffered markers are replayed onto sessionMs when recording starts', async () => {
  const { dispatcher, sent, tick } = fixture();
  await dispatcher.drop({ type: 'hype' });
  tick(5000);
  await dispatcher.drop({ type: 'stress', label: 'ボス' });
  tick(1000);
  await dispatcher.updateStatus({
    reachable: true,
    captureSession: { id: 'session-1', status: 'recording', startedAt: new Date(3000).toISOString() },
  });
  assert.deepEqual(sent, [
    { type: 'hype', label: '', sessionMs: 0 },
    { type: 'stress', label: 'ボス', sessionMs: 3000 },
  ]);
  assert.equal(dispatcher.pendingCount, 0);
});

test('while recording a drop is sent with the elapsed sessionMs', async () => {
  const { dispatcher, sent, tick } = fixture();
  await dispatcher.updateStatus({
    reachable: true,
    captureSession: { id: 'session-1', status: 'recording', startedAt: new Date(1000).toISOString() },
  });
  tick(2500);
  const result = await dispatcher.drop({ type: 'dislike', label: 'カメラ' });
  assert.equal(result.outcome, 'sent');
  assert.deepEqual(sent, [{ type: 'dislike', label: 'カメラ', sessionMs: 2500 }]);
});

test('a failed send goes back to the buffer instead of vanishing', async () => {
  const { dispatcher } = fixture({ fail: true });
  await dispatcher.updateStatus({
    reachable: true,
    captureSession: { id: 'session-1', status: 'recording', startedAt: new Date(0).toISOString() },
  });
  const result = await dispatcher.drop({ type: 'hype' });
  assert.equal(result.outcome, 'buffered');
  assert.equal(result.reason, 'LOCAL_APP_UNREACHABLE');
  assert.equal(dispatcher.pendingCount, 1);
});

test('a flush that fails midway keeps the remaining markers in order', async () => {
  const sent = [];
  let allow = 1;
  const dispatcher = new MarkerDispatcher({
    now: () => 10000,
    postMarker: async (marker) => {
      if (sent.length >= allow) throw Object.assign(new Error('down'), { code: 'LOCAL_APP_UNREACHABLE' });
      sent.push(marker);
    },
  });
  dispatcher.queue.buffer({ type: 'hype', at: 1000 });
  dispatcher.queue.buffer({ type: 'like', at: 2000 });
  dispatcher.queue.buffer({ type: 'stress', at: 3000 });
  const outcome = await dispatcher.updateStatus({
    reachable: true,
    captureSession: { id: 'session-1', status: 'recording', startedAt: new Date(1000).toISOString() },
  });
  assert.equal(outcome.pending, 2);
  assert.deepEqual(sent, [{ type: 'hype', label: '', sessionMs: 0 }]);
  allow = 5;
  const flushed = await dispatcher.flush();
  assert.equal(flushed.sent, 2);
  assert.deepEqual(sent.map((marker) => marker.sessionMs), [0, 1000, 2000]);
});

test('a new drop stays behind a backlog item when flushing fails', async () => {
  const attempts = [];
  let rejectBacklog = true;
  const dispatcher = new MarkerDispatcher({
    now: () => 3000,
    postMarker: async (marker) => {
      attempts.push(marker.type);
      if (marker.type === 'hype' && rejectBacklog) {
        throw Object.assign(new Error('down'), { code: 'LOCAL_APP_UNREACHABLE' });
      }
    },
  });
  dispatcher.queue.buffer({ type: 'hype', at: 1000 });
  dispatcher.status = {
    reachable: true,
    captureSession: { id: 'session-1', status: 'recording', startedAt: new Date(1000).toISOString() },
  };

  const result = await dispatcher.drop({ type: 'like' });
  assert.equal(result.outcome, 'buffered');
  assert.deepEqual(attempts, ['hype']);
  assert.equal(dispatcher.pendingCount, 2);

  rejectBacklog = false;
  await dispatcher.flush();
  assert.deepEqual(attempts, ['hype', 'hype', 'like']);
});

test('state changes are published so the panel can show a disabled marker UI', async () => {
  const states = [];
  const dispatcher = new MarkerDispatcher({ postMarker: async () => {}, onChange: (state) => states.push(state) });
  await dispatcher.updateStatus({ reachable: false, captureSession: null });
  await dispatcher.drop({ type: 'hype' });
  assert.equal(states.at(-1).recording, false);
  assert.equal(states.at(-1).pending, 1);
});

test('a non-recording or malformed session never receives markers', async () => {
  const { dispatcher, sent } = fixture();
  await dispatcher.updateStatus({
    reachable: true,
    captureSession: { id: 'session-1', status: 'paused', startedAt: new Date(0).toISOString() },
  });
  assert.equal((await dispatcher.drop({ type: 'like' })).reason, 'no-active-session');
  await dispatcher.updateStatus({
    reachable: true,
    captureSession: { id: 'session-2', status: 'recording', startedAt: 'not-a-date' },
  });
  assert.equal((await dispatcher.drop({ type: 'stress' })).reason, 'no-active-session');
  assert.deepEqual(sent, []);
});

test('markers buffered while paused flush when the same session starts recording', async () => {
  const { dispatcher, sent } = fixture();
  const captureSession = { id: 'session-1', status: 'paused', startedAt: new Date(0).toISOString() };
  await dispatcher.updateStatus({ reachable: true, captureSession });
  await dispatcher.drop({ type: 'like' });
  await dispatcher.updateStatus({
    reachable: true,
    captureSession: { ...captureSession, status: 'recording' },
  });
  assert.equal(dispatcher.pendingCount, 0);
  assert.deepEqual(sent, [{ type: 'like', label: '', sessionMs: 1000 }]);
});
