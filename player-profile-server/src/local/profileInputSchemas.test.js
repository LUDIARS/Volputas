const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateDedication,
  validateEmotionCurveInput,
  validateGameplayInput,
  validateVoiceInput,
} = require('./profileInputSchemas');

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
