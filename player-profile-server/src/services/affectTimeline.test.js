const test = require('node:test');
const assert = require('node:assert/strict');
const { DIM } = require('@ludiars/sentiment-core');
const { aggregatePlaySession, aggregateTimeline } = require('./affectTimeline');

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
