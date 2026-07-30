const test = require('node:test');
const assert = require('node:assert/strict');
const { extractPitchMechanicIds } = require('./pitchMechanicExtraction');
const { pitchContributions } = require('./pitchContributions');
const { validatePitchInput } = require('../profileEvidenceSchemas');

test('pitch validation requires title and body while references stay optional', () => {
  assert.deepEqual(validatePitchInput({
    title: 'Endless Citadel',
    body: 'Build a party and explore a changing ruin.',
  }), {
    title: 'Endless Citadel',
    body: 'Build a party and explore a changing ruin.',
    referenceGames: '',
  });
  assert.throws(() => validatePitchInput({ title: '', body: 'body' }));
  assert.throws(() => validatePitchInput({ title: 'title', body: '' }));
});

test('pitch mechanic extraction matches Ludus names and the roguelike alias deterministically', () => {
  const text = 'ローグライクに、会話/ダイアログと Fast Travel を組み合わせる。';
  const expected = [
    'open-world/fast-travel',
    'runner/procedural-track',
    'story-jrpg/dialogue-system',
  ];
  assert.deepEqual(extractPitchMechanicIds(text), expected);
  assert.deepEqual(extractPitchMechanicIds(text), expected);
});

test('a pitch produces mechanic reactions, category axes, authorship, and affect', () => {
  const result = pitchContributions([{
    id: 'pitch-1',
    title: 'The Changing Tower',
    body: 'ローグライクの塔を自由な発想で攻略する。',
  }]);
  assert.deepEqual(result.mechanicReactions, [{
    mechanicId: 'runner/procedural-track',
    sentiment: 1,
    samples: 1,
    sources: ['pitch:pitch-1'],
  }]);
  assert.ok(result.contributions.some((item) =>
    item.axis === 'mtg.johnny' && item.value === 0.6 && item.weight === 1));
  assert.ok(result.contributions.some((item) =>
    item.axis === 'style.autonomy' && item.value === 0.6 && item.weight === 1));
  assert.ok(result.contributions.some((item) =>
    item.axis === 'style.mastery'
    && item.source.field === 'mechanicVocabulary'));
  assert.deepEqual(result.affectSamples, [{
    text: 'ローグライクの塔を自由な発想で攻略する。',
    weight: 1,
  }]);
});
