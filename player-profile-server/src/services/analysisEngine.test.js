const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DIMENSIONS,
  EVENT_DIMENSION_MAP,
  integrateSurveyResponses,
} = require('./analysisEngine');

test('session heartbeat no longer changes personality dimensions', () => {
  assert.equal(EVENT_DIMENSION_MAP.session_heartbeat, undefined);
});

test('choice questions use configured option weight and preserve legacy fallback', async () => {
  const vector = new Array(DIMENSIONS.length).fill(0);
  const counts = new Array(DIMENSIONS.length).fill(0);
  const database = {
    async query() {
      return {
        rows: [{
          questions: [
            {
              id: 'weighted',
              type: 'choice',
              dimension: 'power_fantasy',
              options: [{ value: 'yes', weight: 8 }],
            },
            {
              id: 'legacy',
              type: 'choice',
              dimension: 'winning',
              options: ['yes'],
            },
          ],
          answers: { weighted: 'yes', legacy: 'yes' },
        }],
      };
    },
  };
  await integrateSurveyResponses('user-1', vector, counts, database);
  assert.equal(vector[DIMENSIONS.indexOf('gamer_timmy')], 8);
  assert.equal(vector[DIMENSIONS.indexOf('gamer_spike')], 5);
});

test('choice questions prefer the shared -1..1 scoring map over legacy option weight', async () => {
  const vector = new Array(DIMENSIONS.length).fill(0);
  const counts = new Array(DIMENSIONS.length).fill(0);
  const database = {
    async query() {
      return {
        rows: [{
          questions: [{
            id: 'scored',
            type: 'choice',
            dimension: 'power_fantasy',
            axis: 'mtg.timmy',
            options: [{ value: 'a', label: 'agree' }, { value: 'b', label: 'disagree', weight: 1 }],
            scoring: { a: 0.9, b: -0.9 },
          }],
          answers: { scored: 'a' },
        }],
      };
    },
  };
  await integrateSurveyResponses('user-1', vector, counts, database);
  // (0.9 + 1) * 5 = 9.5, not the legacy options[].weight
  assert.equal(vector[DIMENSIONS.indexOf('gamer_timmy')], 9.5);
});
