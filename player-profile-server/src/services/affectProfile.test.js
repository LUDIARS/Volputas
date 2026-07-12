const test = require('node:test');
const assert = require('node:assert/strict');
const { DIM } = require('@ludiars/sentiment-core');
const { collectFreeTextSamples, computeAffectProfile } = require('./affectProfile');

test('affect profile is absent with zero free-text samples', () => {
  assert.equal(computeAffectProfile([]), null);
});

test('free-text answers produce a weighted 20-dimensional profile', () => {
  const samples = collectFreeTextSamples([{
    questions: [
      { id: 'a', type: 'freetext', weight: 2 },
      { id: 'b', type: 'scale' },
    ],
    answers: { a: '最高に楽しい!', b: 5 },
  }]);
  const profile = computeAffectProfile(samples);
  assert.equal(profile.vector.length, DIM);
  assert.equal(profile.sampleTexts, 1);
  assert.equal(profile.vectorSpecVersion, 1);
});
