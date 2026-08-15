const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildSessionSeries,
  normalizeCurve,
  resampleSeries,
  sessionDurationSeconds,
  summarizePoints,
} = require('./arcSeries');

test('session duration prefers the declared playtime unless entries run past it', () => {
  assert.equal(sessionDurationSeconds({ sessionPlaytimeMinutes: 10, entries: [{ timeSeconds: 30 }] }), 600);
  assert.equal(sessionDurationSeconds({ sessionPlaytimeMinutes: 1, entries: [{ timeSeconds: 90 }] }), 90);
  assert.equal(sessionDurationSeconds({ entries: [{ timeSeconds: 40 }, { timeSeconds: 120 }] }), 120);
  assert.equal(sessionDurationSeconds({ entries: [] }), 0);
});

test('video and capture curves are placed by time, memory sketches by position', () => {
  const video = normalizeCurve({
    id: 'v', mode: 'video', sessionPlaytimeMinutes: 10, sessionLabel: '初回',
    entries: [
      { timeSeconds: 300, stamp: 'hype', valence: 2, arousal: 5 },
      { timeSeconds: 0, comment: 'start', valence: 0, arousal: 3 },
      { timeSeconds: 900, stamp: 'stress', valence: -2, arousal: 5 },
    ],
  });
  assert.deepEqual(video.points.map((point) => point.position), [0, 1 / 3, 1]);
  assert.equal(video.points[1].stamp, 'hype');
  assert.equal(video.durationSeconds, 900);

  const memory = normalizeCurve({
    id: 'm', mode: 'memory',
    entries: [{ position: 25, stamp: 'like', valence: 2, arousal: 2 }],
  });
  assert.equal(memory.points[0].position, 0.25);
  assert.equal(memory.durationSeconds, null);
});

test('resampling smooths sparse entries onto bins and leaves uncovered bins null', () => {
  const series = resampleSeries([
    { position: 0.1, valence: 2, arousal: 5 },
    { position: 0.9, valence: -2, arousal: 1 },
  ], { binCount: 10, bandwidth: 0.08 });
  assert.equal(series.centers.length, 10);
  assert.equal(series.valence[0], 2);
  assert.equal(series.valence[1], 2);
  assert.equal(series.valence[9], -2);
  assert.equal(series.arousal[9], 1);
  // The middle of the axis is far from both entries: no evidence, no value.
  assert.equal(series.valence[4], null);
  assert.equal(series.weight[4], 0);
  assert.throws(() => resampleSeries([], { binCount: 1 }), /binCount/);
});

test('point summaries count stamps and locate the valence peak', () => {
  const summary = summarizePoints([
    { position: 0.2, valence: -1, arousal: 2, stamp: 'dislike' },
    { position: 0.7, valence: 2, arousal: 5, stamp: 'hype' },
    { position: 0.9, valence: 1, arousal: 4, stamp: 'hype' },
  ]);
  assert.equal(summary.entryCount, 3);
  assert.equal(summary.meanValence, 0.6667);
  assert.equal(summary.peakPosition, 0.7);
  assert.deepEqual(summary.stampCounts, { dislike: 1, hype: 2 });
  assert.equal(summarizePoints([]).meanValence, null);
});

test('buildSessionSeries carries the metadata the aggregate needs', () => {
  const session = buildSessionSeries({
    id: 'r1', mode: 'capture', createdAt: '2026-08-01T00:00:00.000Z', narrativeArc: '導入',
    sessionPlaytimeMinutes: 5, totalPlaytimeHours: 3,
    entries: [{ timeSeconds: 150, stamp: 'hype', valence: 2, arousal: 5 }],
  }, { binCount: 4 });
  assert.equal(session.recordId, 'r1');
  assert.equal(session.declaredArc, '導入');
  assert.equal(session.series.valence.length, 4);
  assert.equal(session.summary.entryCount, 1);
});
