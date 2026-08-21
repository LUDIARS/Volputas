const test = require('node:test');
const assert = require('node:assert/strict');
const { GEQ_COMPONENTS, PENS_SUBSCALES } = require('./scaleDefinitions');
const { scoreScales, unitScore, validateScales } = require('./scaleScores');
const { scaleAxisSignals } = require('./scaleContributions');

test('definitions: GEQ in-game has 7 components x 2 items, PENS has 5 one-item subscales', () => {
  assert.equal(GEQ_COMPONENTS.length, 7);
  assert.ok(GEQ_COMPONENTS.every((component) => component.items.length === 2));
  assert.equal(PENS_SUBSCALES.length, 5);
  assert.ok(PENS_SUBSCALES.every((subscale) => subscale.items.length === 1));
});

test('validateScales keeps known integer answers in range and drops empty families', () => {
  const scales = validateScales({
    geq: { competence_1: '3', competence_2: 4, flow_1: '' },
    pens: { autonomy: null },
  });
  assert.deepEqual(scales, { geq: { competence_1: 3, competence_2: 4 } });
  assert.equal(validateScales(undefined), null);
  assert.equal(validateScales({ geq: {} }), null);
});

test('validateScales rejects unknown keys and out-of-range values', () => {
  const code = (error) => error.code === 'INVALID_PROFILE_INPUT';
  assert.throws(() => validateScales([]), code);
  assert.throws(() => validateScales({ sam: { valence: 1 } }), code);
  assert.throws(() => validateScales({ geq: { __proto__x: 1 } }), code);
  assert.throws(() => validateScales({ geq: { competence_1: 5 } }), code);
  assert.throws(() => validateScales({ pens: { autonomy: 0 } }), code);
  assert.throws(() => validateScales({ pens: { autonomy: 2.5 } }), code);
});

test('scoreScales averages answered items per subscale and tracks coverage', () => {
  const scored = scoreScales({ geq: { competence_1: 3, competence_2: 4, tension_1: 1 }, pens: { presence: 6 } });
  assert.deepEqual(scored.geq.competence, { score: 3.5, answered: 2, of: 2 });
  assert.deepEqual(scored.geq.tension, { score: 1, answered: 1, of: 2 });
  assert.equal(scored.geq.flow, undefined);
  assert.deepEqual(scored.pens.presence, { score: 6, answered: 1, of: 1 });
  assert.equal(scoreScales(null), null);
});

test('an inverted subscale never turns a missing score into full strength', () => {
  // intuitiveControls is an inverted mapping (1 - unit). A subscale that never
  // scored must produce no signal at all, not value 1.
  const signals = scaleAxisSignals({ pens: { intuitiveControls: 7 } });
  assert.equal(signals.length, 1);
  assert.equal(signals[0].value, 0, 'a maximal intuitive-controls answer means zero onboarding need');
  assert.deepEqual(scaleAxisSignals(null), []);
  assert.deepEqual(scaleAxisSignals({ pens: {} }), []);
});

test('unitScore maps each family range onto 0..1', () => {
  assert.equal(unitScore('geq', 0), 0);
  assert.equal(unitScore('geq', 4), 1);
  assert.equal(unitScore('pens', 4), 0.5);
  assert.equal(unitScore('pens', null), null);
});
