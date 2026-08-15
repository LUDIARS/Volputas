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

test('recordings and speech affect ride the same session clock as gaze and markers', () => {
  const timeline = buildTimeline({
    session: {
      id: 's2',
      gameTitle: 'X',
      status: 'interrupted',
      startedAt: '2026-08-13T00:00:00.000Z',
      endedAt: null,
      markers: [],
      anchors: [],
      capture: {
        gazeSampleCount: 0,
        gazeSource: 'face-video',
        audioFileName: 's2.webm',
        audioDurationSeconds: 90,
        audioStartSessionMs: 500,
        screenRecording: {
          fileName: 's2.mp4', contentType: 'video/mp4', startSessionMs: 2000,
          durationSeconds: 100, width: 1920, height: 1080,
        },
        faceRecording: null,
      },
      analysis: {
        utterances: [
          { sessionMs: 40000, endSessionMs: 41000, text: 'later', valence: -1, arousal: 4 },
          { sessionMs: 5000, endSessionMs: 6000, text: 'first', valence: 2, arousal: 5 },
        ],
      },
    },
    gazeSamples: [],
  });
  assert.equal(timeline.media.screen.startSessionMs, 2000);
  assert.equal(timeline.media.screen.endSessionMs, 102000);
  assert.equal(timeline.media.face, null);
  assert.equal(timeline.media.audio.endSessionMs, 90500);
  // Interrupted sessions take their length from the longest known media.
  assert.equal(timeline.durationMs, 102000);
  assert.equal(timeline.gazeSource, 'face-video');
  assert.deepEqual(timeline.affect.map((point) => point.text), ['first', 'later']);
  assert.equal(timeline.affect[0].valence, 2);
});

test('sessions recorded before recordings existed still build a timeline', () => {
  const timeline = buildTimeline({
    session: {
      id: 's3', gameTitle: 'X', status: 'completed',
      startedAt: '2026-08-13T00:00:00.000Z', endedAt: '2026-08-13T00:00:10.000Z',
      markers: [], anchors: [],
    },
  });
  assert.deepEqual(timeline.media, { screen: null, face: null, audio: null });
  assert.deepEqual(timeline.affect, []);
  assert.equal(timeline.gazeSource, null);
});
