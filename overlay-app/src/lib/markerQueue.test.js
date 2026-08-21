import test from 'node:test';
import assert from 'node:assert/strict';
import { MarkerQueue, rebaseMarker } from './markerQueue.js';

test('markers dropped before a session starts are kept and rebased on drain', () => {
  const queue = new MarkerQueue({ now: () => 1000 });
  assert.deepEqual(queue.buffer({ type: 'hype' }), { buffered: true, overflowed: false, size: 1 });
  queue.buffer({ type: 'stress', label: 'ボス', at: 4000 });
  assert.equal(queue.size, 2);
  const drained = queue.drain(2000);
  assert.deepEqual(drained, [
    { type: 'hype', label: '', sessionMs: 0 },
    { type: 'stress', label: 'ボス', sessionMs: 2000 },
  ]);
  assert.equal(queue.size, 0);
});

test('drain accepts the ISO startedAt the local API reports', () => {
  const queue = new MarkerQueue();
  queue.buffer({ type: 'like', at: Date.parse('2026-08-21T00:00:10.000Z') });
  assert.deepEqual(queue.drain('2026-08-21T00:00:00.000Z'), [
    { type: 'like', label: '', sessionMs: 10000 },
  ]);
  assert.throws(() => queue.drain('not-a-date'), { code: 'INVALID_SESSION_START' });
});

test('a failed send can be restored ahead of newer markers', () => {
  const queue = new MarkerQueue({ now: () => 10 });
  queue.buffer({ type: 'like', at: 30 });
  queue.restore([{ type: 'hype', label: '', at: 20 }]);
  assert.deepEqual(queue.pending.map((marker) => marker.at), [20, 30]);
});

test('restore reports newer markers that no longer fit instead of losing them silently', () => {
  const queue = new MarkerQueue({ maximumPending: 1 });
  queue.buffer({ type: 'like', at: 30 });
  queue.restore([{ type: 'hype', label: '', at: 20 }]);
  assert.deepEqual(queue.pending.map((marker) => marker.at), [20]);
  assert.equal(queue.overflowed, 1);
});

test('unknown marker types are refused instead of being silently stored', () => {
  const queue = new MarkerQueue();
  assert.throws(() => queue.buffer({ type: 'boo' }), { code: 'UNKNOWN_MARKER_TYPE' });
});

test('overflow is reported rather than dropping silently', () => {
  const queue = new MarkerQueue({ now: () => 1, maximumPending: 1 });
  queue.buffer({ type: 'hype' });
  const result = queue.buffer({ type: 'hype' });
  assert.deepEqual(result, { buffered: false, overflowed: true, size: 1 });
  assert.equal(queue.overflowed, 1);
});

test('a persisted queue round-trips and drops malformed entries', () => {
  const queue = new MarkerQueue({ now: () => 5 });
  queue.buffer({ type: 'dislike', label: 'カメラ' });
  const restored = MarkerQueue.from(JSON.parse(JSON.stringify({
    ...queue.toJSON(),
    pending: [...queue.toJSON().pending, { type: 'nope', at: 1 }, { type: 'hype' }],
  })));
  assert.deepEqual(restored.pending, [{ type: 'dislike', label: 'カメラ', at: 5 }]);
});

test('rebaseMarker never returns a negative sessionMs', () => {
  assert.deepEqual(rebaseMarker({ type: 'hype', label: '', at: 100 }, 500), {
    type: 'hype', label: '', sessionMs: 0,
  });
});
