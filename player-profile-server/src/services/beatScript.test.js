const test = require('node:test');
const assert = require('node:assert/strict');
const { DIM, loadAffectVocabulary } = require('@ludiars/sentiment-core');
const { beatScriptToTargetSeries, beatTargetVector, validateBeatScript } = require('./beatScript');
const { computeTimelineGap } = require('./timelineGap');

const beats = [
  {
    beat: 'tutorial',
    order: 1,
    intended_affect: ['discovery'],
    intended_intensity: 0.3,
    markers: { t_hint_ms: [0, 60_000] },
  },
  {
    beat: 'boss',
    order: 2,
    intended_affect: ['tension_release'],
    intended_intensity: 0.9,
    markers: {},
  },
];

test('beat scripts validate controlled vocabulary and build 20d targets', () => {
  assert.equal(validateBeatScript(beats).length, 2);
  assert.equal(beatTargetVector(beats[0]).length, DIM);
  assert.deepEqual(beatScriptToTargetSeries(beats, 30_000).unaligned, ['boss']);
  for (const entry of loadAffectVocabulary()) {
    assert.doesNotThrow(() => validateBeatScript([{ ...beats[0], intended_affect: [entry.key] }]));
  }
});

test('timeline gap reports match and explicit unaligned beats', () => {
  const vector = beatTargetVector(beats[0]);
  const result = computeTimelineGap([
    { t: 0, vector, n: 2 },
    { t: 30_000, vector, n: 1 },
  ], beats);
  assert.equal(result.beats[0].matchScore, 1);
  assert.equal(result.beats[0].bins, 2);
  assert.deepEqual(result.unaligned, ['boss']);
});
