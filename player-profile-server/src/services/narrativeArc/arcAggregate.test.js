const test = require('node:test');
const assert = require('node:assert/strict');
const { binCenters } = require('./arcSeries');
const {
  ARC_ARCHETYPES,
  aggregateArc,
  classifyShape,
  consistency,
  meanAndDeviation,
  pearson,
  trendSlope,
} = require('./arcAggregate');

function session(recordId, valence, { createdAt = null, meanValence = null, arousal = null } = {}) {
  return {
    recordId,
    sessionLabel: recordId,
    mode: 'video',
    createdAt,
    daysAfterPlay: null,
    totalPlaytimeHours: null,
    sessionPlaytimeMinutes: null,
    declaredArc: '',
    summary: {
      entryCount: valence.filter((value) => value !== null).length,
      meanValence,
      meanArousal: null,
      peakPosition: null,
      stampCounts: {},
    },
    series: {
      centers: binCenters(valence.length),
      valence,
      arousal: arousal || valence.map((value) => (value === null ? null : 3)),
      weight: valence.map((value) => (value === null ? 0 : 1)),
    },
  };
}

test('pearson, mean/deviation and trend slope handle gaps and degenerate input', () => {
  assert.equal(pearson([1, 2, 3], [2, 4, 6]), 1);
  assert.equal(pearson([1, 2, 3], [3, 2, 1]), -1);
  assert.equal(pearson([1, 1, 1], [1, 2, 3]), null);
  assert.equal(pearson([1, null, 3], [1, 5, 3]), 1);
  assert.deepEqual(meanAndDeviation([1, null, 3]), { mean: 2, deviation: 1, n: 2 });
  assert.deepEqual(meanAndDeviation([null]), { mean: null, deviation: null, n: 0 });
  assert.equal(trendSlope([0, 1, 2]), 1);
  assert.equal(trendSlope([2, null, 0]), -1);
  assert.equal(trendSlope([1]), null);
});

test('shape classification recovers each archetype from its own template', () => {
  const centers = binCenters(20);
  for (const archetype of ARC_ARCHETYPES) {
    const shape = classifyShape(centers, centers.map(archetype.shape));
    assert.equal(shape.archetype, archetype.id, `expected ${archetype.id}, got ${shape.archetype}`);
    assert.ok(shape.correlation > 0.99);
    assert.equal(shape.candidates.length, ARC_ARCHETYPES.length);
  }
  assert.equal(classifyShape(centers, centers.map(() => 1)).archetype, 'flat');
  assert.equal(classifyShape(centers, [1, 2, null, null, ...Array(16).fill(null)]).archetype, null);
});

test('the aggregate arc reports mean bins, extremes, ending, trend and consistency', () => {
  const rise = [-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 2];
  const riseLater = [-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 1];
  const analysis = aggregateArc([
    session('second', riseLater, { createdAt: '2026-08-02T00:00:00.000Z', meanValence: 0.5 }),
    session('first', rise, { createdAt: '2026-08-01T00:00:00.000Z', meanValence: 0.2 }),
  ]);
  assert.equal(analysis.sessionCount, 2);
  assert.equal(analysis.binCount, 10);
  assert.equal(analysis.bins[0].valence, -2);
  assert.equal(analysis.bins[9].valence, 1.5);
  assert.equal(analysis.bins[9].valenceDeviation, 0.5);
  assert.equal(analysis.bins[9].coverage, 2);
  assert.equal(analysis.shape.archetype, 'rags-to-riches');
  assert.equal(analysis.peak.position, 0.85);
  assert.equal(analysis.peak.valence, 2);
  assert.equal(analysis.valley.valence, -2);
  // Ending = mean of the last three bins: (1.5 + 2 + 1.5) / 3.
  assert.equal(analysis.ending, 1.6667);
  assert.ok(Math.abs(analysis.peakEnd - 1.83335) < 0.001, `peakEnd ${analysis.peakEnd}`);
  assert.ok(analysis.consistency > 0.95);
  // Sessions are ordered by createdAt for the trend, not by input order.
  assert.deepEqual(analysis.trend.order, ['first', 'second']);
  assert.deepEqual(analysis.trend.sessionMeans, [0.2, 0.5]);
  assert.equal(analysis.trend.slope, 0.3);
  assert.equal(analysis.sessions[0].recordId, 'first');
});

test('bins nobody covered stay null and the arc refuses fewer than two sessions', () => {
  const analysis = aggregateArc([
    session('a', [1, null, null, -1]),
    session('b', [2, null, null, 0]),
  ]);
  assert.equal(analysis.bins[1].valence, null);
  assert.equal(analysis.bins[1].coverage, 0);
  assert.equal(analysis.shape.archetype, null);
  assert.equal(consistency([session('a', [1, null, null, -1]), session('b', [2, null, null, 0])]), 1);
  assert.throws(
    () => aggregateArc([session('only', [1, 2, 3, 4])]),
    (error) => error.code === 'NARRATIVE_ARC_INSUFFICIENT_SESSIONS'
  );
  assert.throws(() => aggregateArc([session('a', [1, 2]), session('b', [1, 2, 3])]), /same bin count/);
});
