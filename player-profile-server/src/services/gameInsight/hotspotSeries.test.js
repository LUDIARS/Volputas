const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildCohortSessions,
  nearestBin,
  placeEntries,
  referenceLengthSeconds,
} = require('./hotspotSeries');

const video = (id, entries, extra = {}) => ({ id, mode: 'video', gameTitle: 'G', entries, ...extra });

test('reference length is the longest time-axis session; memory sketches do not count', () => {
  const records = [
    video('a', [{ timeSeconds: 100, valence: 1, arousal: 3 }]),
    video('b', [{ timeSeconds: 30, valence: 1, arousal: 3 }], { sessionPlaytimeMinutes: 5 }),
    { id: 'm', mode: 'memory', entries: [{ position: 100, valence: 2, arousal: 5 }] },
  ];
  assert.equal(referenceLengthSeconds(records), 300);
  assert.equal(referenceLengthSeconds([records[2]]), 0);
});

test('entries are placed on the shared axis by absolute time, memory by percent', () => {
  const timed = placeEntries(video('a', [{ timeSeconds: 150, valence: 1, arousal: 4, stamp: 'hype' }]), 300);
  assert.equal(timed[0].position, 0.5);
  assert.equal(timed[0].timeSeconds, 150);
  const memory = placeEntries({ mode: 'memory', entries: [{ position: 25, valence: -1, arousal: 2 }] }, 300);
  assert.equal(memory[0].position, 0.25);
  assert.equal(memory[0].timeSeconds, null);
});

test('malformed imported entries are ignored or bounded at the cohort boundary', () => {
  const points = placeEntries(video('a', [
    null,
    { timeSeconds: 30, valence: Infinity, arousal: -10, stamp: {}, comment: { text: 'x' } },
    { timeSeconds: 40, valence: 99, arousal: 99, stamp: '__proto__', comment: 'ok' },
  ]), 100);
  assert.equal(points.length, 2);
  assert.deepEqual(points[0], {
    position: 0.3, timeSeconds: 30, valence: 0, arousal: 1, stamp: null, comment: '',
  });
  assert.deepEqual(points[1], {
    position: 0.4, timeSeconds: 40, valence: 2, arousal: 5, stamp: '__proto__', comment: 'ok',
  });
  assert.equal(referenceLengthSeconds([video('bad', [{ timeSeconds: Infinity }])]), 0);
  assert.equal(referenceLengthSeconds([video('long', [{ timeSeconds: 1e9 }])]), 864000);
  assert.equal(placeEntries(video('many', Array.from({ length: 501 }, () => ({ timeSeconds: 1 }))), 10).length, 500);
});

test('cohort sessions carry end positions only for time-axis records', () => {
  const cohort = buildCohortSessions([
    { playerKey: 'p1', record: video('a', [{ timeSeconds: 200, valence: 1, arousal: 3 }]) },
    { playerKey: 'p2', record: video('b', [{ timeSeconds: 50, valence: -1, arousal: 4, stamp: 'stress' }]) },
    { playerKey: 'p2', record: { id: 'm', mode: 'memory', entries: [{ position: 90, valence: 2, arousal: 5, stamp: 'hype' }] } },
  ], { binCount: 10 });
  assert.equal(cohort.referenceLengthSeconds, 200);
  assert.equal(cohort.sessions[0].endPosition, 1);
  assert.equal(cohort.sessions[1].endPosition, 0.25);
  assert.equal(cohort.sessions[2].endPosition, null);
  assert.deepEqual(cohort.sessions[1].stampedBins, [{ bin: 2, stamp: 'stress' }]);
  assert.deepEqual(cohort.sessions[2].stampedBins, [{ bin: 9, stamp: 'hype' }]);
  assert.equal(cohort.sessions[0].series.valence.length, 10);
});

test('nearestBin clamps to the bin range', () => {
  assert.equal(nearestBin(0, 20), 0);
  assert.equal(nearestBin(1, 20), 19);
  assert.equal(nearestBin(0.5, 20), 10);
});
