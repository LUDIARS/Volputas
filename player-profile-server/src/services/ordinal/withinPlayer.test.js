const test = require('node:test');
const assert = require('node:assert/strict');
const { baseline, normalizeWithinPlayer, percentileRank, zScore } = require('./withinPlayer');

test('baseline ignores nulls and reports count', () => {
  assert.deepEqual(baseline([1, null, 3]), { mean: 2, sd: 1, count: 2 });
  assert.deepEqual(baseline([null]), { mean: null, sd: null, count: 0 });
});

test('z-score is relative to the player; a flat recorder is 0, not null', () => {
  const loud = normalizeWithinPlayer([2, 2, 2]);
  assert.deepEqual(loud.z, [0, 0, 0]);
  const varied = normalizeWithinPlayer([0, 2, 4]);
  assert.deepEqual(varied.z.map((value) => Number(value.toFixed(4))), [-1.2247, 0, 1.2247]);
  assert.equal(zScore(null, baseline([1, 2])), null);
  assert.equal(zScore(1, baseline([])), null);
});

test('two players with different loudness land on the same ordinal footing', () => {
  const quiet = normalizeWithinPlayer([0, 0, 1]);
  const loud = normalizeWithinPlayer([1, 1, 2]);
  // Same shape, different offset: equal up to floating-point noise.
  assert.equal(quiet.z.length, loud.z.length);
  quiet.z.forEach((value, index) => {
    assert.ok(Math.abs(value - loud.z[index]) < 1e-12);
  });
  assert.deepEqual(quiet.rank, loud.rank);
});

test('percentile rank uses mid-ranks for ties and 0.5 for a single record', () => {
  assert.equal(percentileRank(3, [1, 2, 3]), 1);
  assert.equal(percentileRank(1, [1, 2, 3]), 0);
  assert.equal(percentileRank(2, [1, 2, 2, 3]), 0.5);
  assert.equal(percentileRank(7, [7]), 0.5);
  assert.equal(percentileRank(null, [1, 2]), null);
});

test('a wider pool scores one session against the whole player', () => {
  const session = [1, 1];
  const result = normalizeWithinPlayer(session, [1, 1, 3, 3]);
  assert.deepEqual(result.z, [-1, -1]);
  assert.deepEqual(result.rank, [1 / 6, 1 / 6]);
  assert.equal(result.baseline.count, 4);
});
