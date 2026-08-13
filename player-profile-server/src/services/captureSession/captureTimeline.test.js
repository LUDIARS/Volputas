const test = require('node:test');
const assert = require('node:assert/strict');
const { aggregateGazeBins, buildTimeline } = require('./captureTimeline');

test('gaze bins separate focused, scattered, and off-screen intervals', () => {
  const fixated = Array.from({ length: 10 }, (_, i) => ({
    sessionMs: i * 100, x: 0.5, y: 0.5, valid: true,
  }));
  const scattered = [
    { sessionMs: 5000, x: 0.05, y: 0.05, valid: true },
    { sessionMs: 5100, x: 0.95, y: 0.95, valid: true },
    { sessionMs: 5200, x: 0.05, y: 0.95, valid: true },
    { sessionMs: 5300, x: 0.95, y: 0.05, valid: true },
  ];
  const away = [
    { sessionMs: 10000, x: -0.5, y: 0.5, valid: true },
    { sessionMs: 10100, x: 1.5, y: 0.5, valid: true },
  ];
  const bins = aggregateGazeBins([...fixated, ...scattered, ...away], 5000);
  assert.deepEqual(bins.map((bin) => bin.t), [0, 5000, 10000]);

  assert.equal(bins[0].onScreenRatio, 1);
  assert.equal(bins[0].dispersion, 0);
  assert.equal(bins[0].focusScore, 1);

  assert.equal(bins[1].onScreenRatio, 1);
  assert.ok(bins[1].dispersion > 0.5, `scattered dispersion: ${bins[1].dispersion}`);
  assert.equal(bins[1].focusScore, 0);

  assert.equal(bins[2].onScreenRatio, 0);
  assert.equal(bins[2].dispersion, null);
  assert.equal(bins[2].focusScore, 0);
});

test('invalid samples lower validRatio and are excluded from focus', () => {
  const bins = aggregateGazeBins([
    { sessionMs: 0, x: 0.5, y: 0.5, valid: true },
    { sessionMs: 100, x: 0.5, y: 0.5, valid: false },
  ], 5000);
  assert.equal(bins[0].validRatio, 0.5);
  assert.equal(bins[0].onScreenRatio, 0.5);
});

test('the timeline merges markers and anchors on the session clock', () => {
  const session = {
    id: 's1',
    gameTitle: 'X',
    status: 'completed',
    startedAt: '2026-08-13T00:00:00.000Z',
    endedAt: '2026-08-13T00:01:00.000Z',
    markers: [
      { sessionMs: 30000, origin: 'companion', type: 'hype', label: '' },
      { sessionMs: 10000, origin: 'game', type: 'event', label: 'boss' },
    ],
    anchors: [{ sessionMs: 0, gameClockMs: 120000 }],
  };
  const timeline = buildTimeline({
    session,
    gazeSamples: [{ sessionMs: 2000, x: 0.5, y: 0.5, valid: true }],
  });
  assert.equal(timeline.durationMs, 60000);
  assert.deepEqual(timeline.markers.map((m) => m.sessionMs), [10000, 30000]);
  assert.equal(timeline.anchors[0].gameClockMs, 120000);
  assert.equal(timeline.gaze.length, 1);
});

test('a still-recording timeline derives duration from observed activity', () => {
  const timeline = buildTimeline({
    session: {
      id: 's1',
      gameTitle: 'X',
      status: 'recording',
      startedAt: '2026-08-13T00:00:00.000Z',
      endedAt: null,
      markers: [{ sessionMs: 45000, origin: 'game', type: 'note', label: '' }],
      anchors: [],
    },
    gazeSamples: [],
  });
  assert.equal(timeline.durationMs, 45000);
});
