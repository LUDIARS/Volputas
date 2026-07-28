const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateDedication,
  validateEmotionCurveInput,
  validateGameplayInput,
  validateVoiceInput,
} = require('../services/profileEvidenceSchemas');

test('dedication uses only supplied gameplay evidence and reports confidence', () => {
  assert.deepEqual(calculateDedication({
    playtimeHours: null,
    completionPercent: null,
    achievementsUnlocked: null,
    achievementsTotal: null,
    selfRatedMastery: null,
  }), {
    score: null,
    confidence: 'needs-details',
    signalsUsed: 0,
  });

  const gameplay = validateGameplayInput({
    gameTitle: 'Example',
    playtimeHours: 120,
    completionPercent: 80,
    achievementsUnlocked: 8,
    achievementsTotal: 10,
    selfRatedMastery: 4,
  });
  assert.equal(gameplay.dedication.confidence, 'high');
  assert.equal(gameplay.dedication.signalsUsed, 4);
  assert.equal(gameplay.dedication.score, 87);
});

test('voice and emotion curve inputs preserve their analysis metadata', () => {
  const voice = validateVoiceInput({
    gameTitle: 'Example',
    scopeType: 'content',
    contentName: 'Chapter 2',
    sentiment: 2,
    comment: 'The story turn worked well.',
    tags: 'story, character',
  });
  assert.deepEqual(voice.tags, ['story', 'character']);

  const curve = validateEmotionCurveInput({
    gameTitle: 'Example',
    videoFileName: 'play.mp4',
    daysAfterPlay: 3,
    narrativeArc: 'turning point',
    journeyStage: 'mastery',
    entries: [
      { timeSeconds: 20, valence: 2, arousal: 5, comment: 'Success' },
      { timeSeconds: 10, valence: -1, arousal: 3, comment: 'Missed' },
    ],
  });
  assert.equal(curve.daysAfterPlay, 3);
  assert.deepEqual(curve.entries.map((entry) => entry.timeSeconds), [10, 20]);
});

test('emotion stamps default valence and arousal and allow comment-free entries', () => {
  const curve = validateEmotionCurveInput({
    gameTitle: 'Example',
    videoFileName: 'play.mp4',
    gameLogFileName: 'session.log',
    totalPlaytimeHours: 12.5,
    sessionPlaytimeMinutes: 45,
    entries: [
      { timeSeconds: 30, stamp: 'hype' },
      { timeSeconds: 60, stamp: 'dislike', valence: -1 },
      { timeSeconds: 90, comment: 'Free note without stamp' },
    ],
  });
  assert.equal(curve.gameLogFileName, 'session.log');
  assert.equal(curve.totalPlaytimeHours, 12.5);
  assert.equal(curve.sessionPlaytimeMinutes, 45);
  assert.deepEqual(
    curve.entries.map((entry) => [entry.stamp, entry.valence, entry.arousal]),
    [['hype', 2, 5], ['dislike', -1, 2], [null, 0, 3]]
  );

  assert.throws(() => validateEmotionCurveInput({
    gameTitle: 'Example',
    videoFileName: 'play.mp4',
    entries: [{ timeSeconds: 5 }],
  }), (error) => error.code === 'INVALID_PROFILE_INPUT');

  assert.throws(() => validateEmotionCurveInput({
    gameTitle: 'Example',
    videoFileName: 'play.mp4',
    entries: [{ timeSeconds: 5, stamp: 'unknown' }],
  }), (error) => error.code === 'INVALID_PROFILE_INPUT');
});

test('memory-mode emotion curves need positions instead of a video', () => {
  const sketch = validateEmotionCurveInput({
    gameTitle: 'Example',
    mode: 'memory',
    entries: [
      { position: 80, stamp: 'hype', progressLabel: 'ラスボス' },
      { position: 20, stamp: 'stress' },
    ],
  });
  assert.equal(sketch.mode, 'memory');
  assert.equal(sketch.videoFileName, '');
  assert.deepEqual(sketch.entries.map((entry) => entry.position), [20, 80]);
  assert.equal(sketch.entries[1].progressLabel, 'ラスボス');
  assert.equal(sketch.entries[0].timeSeconds, undefined);

  // position is mandatory in memory mode…
  assert.throws(() => validateEmotionCurveInput({
    gameTitle: 'Example',
    mode: 'memory',
    entries: [{ stamp: 'hype' }],
  }), (error) => error.code === 'INVALID_PROFILE_INPUT');

  // …and video mode still requires the video file name.
  assert.throws(() => validateEmotionCurveInput({
    gameTitle: 'Example',
    entries: [{ timeSeconds: 5, stamp: 'hype' }],
  }), (error) => error.code === 'INVALID_PROFILE_INPUT');
});
