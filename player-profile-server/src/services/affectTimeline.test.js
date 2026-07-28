const test = require('node:test');
const assert = require('node:assert/strict');
const { DIM } = require('@ludiars/sentiment-core');
const { aggregatePlaySession, aggregateTimeline, resolveSessionMonoMs } = require('./affectTimeline');

test('viewer reactions aggregate by video time and preserve missing bins', () => {
  const result = aggregateTimeline([
    { content: '最高に面白い!', videoOffsetMs: 1000 },
    { content: 'つまらない', videoOffsetMs: 2000 },
    { content: 'ignored without offset' },
    { content: '神ゲー', videoOffsetMs: 61_000 },
  ], 30_000);
  assert.deepEqual(result.series.map((bin) => bin.t), [0, 60_000]);
  assert.equal(result.series[0].n, 2);
  assert.equal(result.series[0].vector.length, DIM);
  assert.equal(result.meta.eligibleComments, 3);
  assert.equal(result.meta.lexiconHitRate, 1);
});

test('instrumented play events produce deterministic session metrics', () => {
  const series = aggregatePlaySession([
    { monoMs: 100, eventType: 'trial_result', eventData: { correct: true, retries: 0 } },
    { monoMs: 200, eventType: 'trial_result', eventData: { correct: false, retries: 1 } },
  ], 30_000);
  assert.equal(series[0].metrics.accuracy, 0.5);
  assert.equal(series[0].metrics.retries, 1);
});

test('play session metrics recognise the §6.4 trial_result shape', () => {
  const series = aggregatePlaySession([
    { monoMs: 100, eventType: 'ludellus.trial_result', eventData: { outcome: 'correct', corrections: 1 } },
    { monoMs: 200, eventType: 'ludellus.trial_result', eventData: { outcome: 'timeout', corrections: 0 } },
  ], 30_000);
  assert.equal(series[0].metrics.attempts, 2);
  assert.equal(series[0].metrics.correct, 1);
  assert.equal(series[0].metrics.accuracy, 0.5);
  assert.equal(series[0].metrics.retries, 1);
});

test('resolveSessionMonoMs subtracts the recording-start origin when present (§ alignment)', () => {
  // mono_ms is app-relative (§6.1); with a session epoch the timeline is session-relative.
  assert.equal(resolveSessionMonoMs({ eventMonoMs: 1_234_000, sessionEpochMonoMs: 1_230_000 }), 4_000);
  // A trial exactly at recording start lands at t=0.
  assert.equal(resolveSessionMonoMs({ eventMonoMs: 1_230_000, sessionEpochMonoMs: 1_230_000 }), 0);
});

test('resolveSessionMonoMs preserves legacy behaviour when no epoch is available', () => {
  // No epoch, mono present -> raw app-relative mono_ms (unchanged from the old route).
  assert.equal(resolveSessionMonoMs({ eventMonoMs: 1_234_000 }), 1_234_000);
  // No epoch, no mono -> wall-clock delta (occurred_at - started_at).
  assert.equal(resolveSessionMonoMs({
    occurredAt: '2026-07-02T00:00:05.000Z',
    startedAt: '2026-07-02T00:00:00.000Z',
  }), 5_000);
});
