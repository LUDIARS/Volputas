const test = require('node:test');
const assert = require('node:assert/strict');

const { scoreGamerSubtypes, selectPrimarySubtype } = require('./subtypeScoring');

function subtypeQuestion(id, subtype) {
  return {
    id,
    type: 'choice',
    subtype,
    options: [{ value: 'strongly_agree' }, { value: 'strongly_disagree' }],
    scoring: { strongly_agree: 0.9, strongly_disagree: -0.9 },
  };
}

test('agreement answers are rescaled to 0..1 per subtype', () => {
  const scored = scoreGamerSubtypes([{
    questions: [
      subtypeQuestion('q-power', 'timmy.power'),
      subtypeQuestion('q-social', 'timmy.social'),
    ],
    answers: { 'q-power': 'strongly_agree', 'q-social': 'strongly_disagree' },
  }]);

  assert.deepEqual(scored['timmy.power'], { score: 0.95, samples: 1 });
  assert.deepEqual(scored['timmy.social'], { score: 0.05, samples: 1 });
});

test('answers for the same subtype across responses are averaged', () => {
  const scored = scoreGamerSubtypes([
    {
      questions: [subtypeQuestion('q-power', 'timmy.power')],
      answers: { 'q-power': 'strongly_agree' },
    },
    {
      questions: [subtypeQuestion('q-power', 'timmy.power')],
      answers: { 'q-power': 'strongly_disagree' },
    },
  ]);

  assert.deepEqual(scored['timmy.power'], { score: 0.5, samples: 2 });
});

test('unknown subtypes, unscored answers and missing answers contribute nothing', () => {
  const scored = scoreGamerSubtypes([{
    questions: [
      subtypeQuestion('q-unknown', 'timmy.nonexistent'),
      { id: 'q-unscored', type: 'choice', subtype: 'spike.tuner', options: [{ value: 'yes' }] },
      subtypeQuestion('q-missing', 'spike.analyst'),
      { id: 'q-plain', type: 'choice', dimension: 'power_fantasy', options: [{ value: 'yes' }] },
    ],
    answers: { 'q-unknown': 'strongly_agree', 'q-unscored': 'yes', 'q-plain': 'yes' },
  }]);

  assert.deepEqual(scored, {});
});

test('malformed records are skipped instead of throwing', () => {
  assert.deepEqual(scoreGamerSubtypes([
    { questions: null, answers: {} },
    { questions: [subtypeQuestion('q', 'timmy.power')], answers: null },
    null,
  ]), {});
});

test('primary subtype is the highest measured score within the main type', () => {
  const selected = selectPrimarySubtype('spike', {
    'spike.innovator': { score: 0.2, samples: 1 },
    'spike.tuner': { score: 0.8, samples: 1 },
    'spike.analyst': { score: 0.5, samples: 2 },
    // A different main type must not leak into the selection.
    'timmy.power': { score: 0.99, samples: 1 },
  });

  assert.equal(selected.primarySubtype, 'tuner');
  assert.deepEqual(Object.keys(selected.subtypeScores), ['tuner', 'analyst', 'innovator']);
  assert.equal(selected.subtypeScores.nut, undefined);
  assert.deepEqual(selected.subtypeSamples, { tuner: 1, analyst: 2, innovator: 1 });
});

test('ties resolve by declaration order so repeated runs agree', () => {
  const measured = {
    'timmy.social': { score: 0.6, samples: 1 },
    'timmy.power': { score: 0.6, samples: 1 },
  };
  assert.equal(selectPrimarySubtype('timmy', measured).primarySubtype, 'power');
});

test('no measured answers yields null so the caller can fall back explicitly', () => {
  assert.equal(selectPrimarySubtype('timmy', {}), null);
  assert.equal(selectPrimarySubtype('nonexistent', { 'timmy.power': { score: 1, samples: 1 } }), null);
});
