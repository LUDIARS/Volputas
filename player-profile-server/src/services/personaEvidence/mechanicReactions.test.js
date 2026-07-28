const test = require('node:test');
const assert = require('node:assert/strict');
const { collectMechanicReactions, mechanicAversionEvidence } = require('./mechanicReactions');
const { validateVoiceInput } = require('../profileEvidenceSchemas');
const { analyzePersonaV2 } = require('./analyzePersonaV2');

test('voice input validates polarity and normalises mechanic ids', () => {
  const voice = validateVoiceInput({
    gameTitle: 'Example',
    comment: '回避が気持ちいい',
    polarity: 'like',
    mechanicIds: ['Action/Dodge-Roll'],
  });
  assert.equal(voice.polarity, 'like');
  assert.deepEqual(voice.mechanicIds, ['action/dodge-roll']);

  assert.throws(() => validateVoiceInput({
    gameTitle: 'Example',
    comment: 'x',
    mechanicIds: ['../etc/passwd'],
  }), (error) => error.code === 'INVALID_PROFILE_INPUT');

  assert.equal(validateVoiceInput({
    gameTitle: 'Example', comment: 'x', polarity: 'meh',
  }).polarity, null);
});

test('mechanic reactions average sentiment with polarity fixing the direction', () => {
  const voices = [
    { id: 'v1', sentiment: 2, polarity: 'like', mechanicIds: ['action/dodge-roll'] },
    { id: 'v2', sentiment: 0, polarity: 'dislike', mechanicIds: ['action/dodge-roll', 'core/gacha'] },
  ];
  const reactions = collectMechanicReactions(voices);
  assert.deepEqual(reactions.map((item) => item.mechanicId), ['action/dodge-roll', 'core/gacha']);
  const dodge = reactions[0];
  // like(+2) と dislike(強度0→-1) の平均。
  assert.equal(dodge.sentiment, 0.5);
  assert.equal(dodge.samples, 2);
  assert.deepEqual(dodge.sources, ['voice:v1', 'voice:v2']);
});

test('explicit dislikes on mechanics become aversion evidence', () => {
  const evidence = mechanicAversionEvidence([
    { id: 'v2', sentiment: -2, polarity: 'dislike', mechanicIds: ['core/gacha'] },
    { id: 'v3', sentiment: 2, polarity: 'like', mechanicIds: ['core/gacha'] },
  ]);
  assert.deepEqual(evidence, [{
    target: 'mechanic:core/gacha',
    strength: 1,
    source: { kind: 'voice', id: 'v2', field: 'mechanicIds' },
  }]);
});

test('analyzePersonaV2 exposes mechanicReactions and mechanic aversions', () => {
  const analysis = analyzePersonaV2({
    surveys: [],
    gameplay: [],
    voices: [
      { id: 'v1', sentiment: -2, polarity: 'dislike', comment: 'ガチャの天井が渋い', mechanicIds: ['core/gacha'] },
    ],
    emotionCurves: [],
  }, '2026-07-28T18:00:00.000Z');
  assert.equal(analysis.mechanicReactions.length, 1);
  assert.equal(analysis.mechanicReactions[0].mechanicId, 'core/gacha');
  assert.ok(analysis.mechanicReactions[0].sentiment <= -1);
  assert.ok(analysis.aversions.some((item) => item.target === 'mechanic:core/gacha'));
});
