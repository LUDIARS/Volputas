const test = require('node:test');
const assert = require('node:assert/strict');
const { scorePreferenceAxes } = require('./preferenceAxes');

test('axis scoring keeps 15-axis preferences separate from legacy dimensions', () => {
  const scored = scorePreferenceAxes([{
    questions: [
      { id: 'q1', type: 'scale', axis: 'mtg.timmy', options: { min: 1, max: 5 } },
      { id: 'q2', type: 'choice', axis: 'style.explorer', options: [{ value: 'yes', weight: 0.8 }] },
      { id: 'q3', type: 'scale', dimension: 'power_fantasy', options: { min: 1, max: 5 } },
    ],
    answers: { q1: 5, q2: 'yes', q3: 5 },
  }]);
  assert.deepEqual(scored, {
    'mtg.timmy': { score: 1, samples: 1 },
    'style.explorer': { score: 0.8, samples: 1 },
  });
});
