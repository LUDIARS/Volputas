const test = require('node:test');
const assert = require('node:assert/strict');
const {
  detectSubtypes,
  DIMENSIONS,
  EVENT_DIMENSION_MAP,
  integrateSurveyResponses,
  loadMeasuredSubtypeScores,
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

test('measured subtype answers take precedence over the positional heuristic', () => {
  const classification = {
    gamer: { primary: 'spike', scores: { spike: 0.9 } },
    mechanics: { scores: { agon: 0.7, alea: 0.1, ilinx: 0.2, mimicry: 0.3 } },
    story: { scores: { winner: 0.8, banal: 0.2, loser: 0.1 } },
  };
  const measured = {
    'spike.innovator': { score: 0.1, samples: 1 },
    'spike.analyst': { score: 0.9, samples: 1 },
  };

  const detected = detectSubtypes([], classification, measured);
  assert.equal(detected.source, 'survey');
  assert.equal(detected.primarySubtype, 'analyst');
  assert.deepEqual(detected.subtypeScores, { analyst: 0.9, innovator: 0.1 });
  assert.deepEqual(detected.subtypeSamples, { analyst: 1, innovator: 1 });
});

test('subtypes fall back to the heuristic and say so when unmeasured', () => {
  const classification = {
    gamer: { primary: 'timmy', scores: { timmy: 0.9 } },
    mechanics: { scores: { agon: 0.7, alea: 0.1, ilinx: 0.2, mimicry: 0.3 } },
    story: { scores: { winner: 0.8, banal: 0.2, loser: 0.1 } },
  };

  const detected = detectSubtypes([], classification, {});
  assert.equal(detected.source, 'heuristic');
  assert.equal(detected.gamerType, 'timmy');
  assert.deepEqual(Object.keys(detected.subtypeScores).sort(), ['adrenaline', 'diversity', 'power', 'social']);
  assert.equal(detected.subtypeSamples, undefined);
});

test('subtype scores are loaded from the same survey_responses rows', async () => {
  const database = {
    async query() {
      return {
        rows: [{
          questions: [{
            id: 'subtype-melvin-theorist',
            type: 'choice',
            subtype: 'melvin.theorist',
            options: [{ value: 'agree' }],
            scoring: { agree: 0.3 },
          }],
          answers: { 'subtype-melvin-theorist': 'agree' },
        }],
      };
    },
  };

  const measured = await loadMeasuredSubtypeScores('user-1', database);
  assert.deepEqual(measured, { 'melvin.theorist': { score: 0.65, samples: 1 } });
});
