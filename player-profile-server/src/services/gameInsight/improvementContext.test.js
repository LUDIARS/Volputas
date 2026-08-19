const test = require('node:test');
const assert = require('node:assert/strict');
const {
  attachGameContext,
  gameClockAt,
  identifierTokens,
  precedingGameMarkers,
  selectFocusPoints,
} = require('./improvementContext');

test('focus points interleave dropouts and hotspots, merge same-bin duplicates and cap the count', () => {
  const analysis = {
    hotspots: Array.from({ length: 8 }, (_, index) => ({
      kind: index % 2 ? 'pain' : 'hype', bin: index * 2, position: index * 0.1, score: 8 - index,
      valence: 0, arousal: 3, playerCount: 2, agreement: 1, stampPlayers: {}, reasons: [], quotes: [{ comment: 'q' }],
    })),
    dropouts: [
      { bin: 2, position: 0.1, share: 0.5, sessionCount: 2, playerCount: 2, exitValence: -1 },
      { bin: 15, position: 0.775, share: 0.25, sessionCount: 1, playerCount: 1, exitValence: 0 },
    ],
  };
  const points = selectFocusPoints(analysis);
  assert.ok(points.length <= 8);
  const merged = points.find((point) => point.bin === 2);
  assert.deepEqual(merged.types.sort(), ['dropout', 'pain']);
  assert.equal(merged.sessionCount, 2);
  assert.equal(merged.quotes.length, 1);
  assert.deepEqual(points.map((point) => point.index), points.map((_, index) => index + 1));
  assert.ok(points.every((point, index) => index === 0 || point.position >= points[index - 1].position));
});

test('game clock interpolates between anchors and extrapolates outside', () => {
  const anchors = [{ sessionMs: 1000, gameClockMs: 0 }, { sessionMs: 3000, gameClockMs: 4000 }];
  assert.equal(gameClockAt(anchors, 2000), 2000);
  assert.equal(gameClockAt(anchors, 4000), 6000);
  assert.equal(gameClockAt(anchors, 0), -2000);
  assert.equal(gameClockAt([{ sessionMs: 500, gameClockMs: 100 }], 1500), 1100);
  assert.equal(gameClockAt([], 10), null);
});

test('preceding markers are game-origin only, most recent first', () => {
  const markers = [
    { sessionMs: 1000, origin: 'game', type: 'event', label: 'stage:1' },
    { sessionMs: 5000, origin: 'desktop', type: 'hype' },
    { sessionMs: 8000, origin: 'game', type: 'event', label: 'boss:GoblinKing' },
    { sessionMs: 20000, origin: 'game', type: 'event', label: 'later' },
  ];
  const result = precedingGameMarkers(markers, 10000);
  assert.deepEqual(result.map((marker) => marker.label), ['boss:GoblinKing', 'stage:1']);
  assert.equal(result[0].secondsBefore, 2);
});

test('attachGameContext maps positions to the session clock and recording offset', () => {
  const captureSession = {
    id: 'cap-1',
    anchors: [{ sessionMs: 0, gameClockMs: 0 }],
    markers: [{ sessionMs: 20000, origin: 'game', type: 'event', label: 'tutorial_end' }],
    capture: { screenRecording: { startSessionMs: 5000, durationSeconds: 100 } },
  };
  const [point] = attachGameContext([{ position: 0.5, types: ['pain'] }], { captureSession, referenceLengthSeconds: 120 });
  assert.equal(point.sessionMs, 60000);
  assert.equal(point.gameContext.frameSeconds, 55);
  assert.equal(point.gameContext.markers[0].label, 'tutorial_end');
  const [late] = attachGameContext([{ position: 1, types: ['dropout'] }], { captureSession, referenceLengthSeconds: 120 });
  assert.equal(late.gameContext.frameSeconds, null); // beyond the recording
  const [bare] = attachGameContext([{ position: 0.5 }], { captureSession: null, referenceLengthSeconds: 120 });
  assert.equal(bare.gameContext, null);
});

test('identifier tokens come from marker labels', () => {
  assert.deepEqual(identifierTokens(['boss:GoblinKing spawn', 'ステージ2 stage_2', 'ok']), ['boss', 'GoblinKing', 'spawn', 'stage_2']);
});
