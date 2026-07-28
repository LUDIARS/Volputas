const test = require('node:test');
const assert = require('node:assert/strict');
const {
  median,
  weightedPercentile,
  weightedMean,
  weightedProportion,
  computeFreshnessWeight,
  estimateVocabLevel,
  computeTrend7d,
  computeAbilityMetrics,
  computeAbilitySnapshot,
} = require('./abilityEngine');

const DAY_MS = 86_400_000;

// Build a trial in the shape extractTrial() produces.
function T(o) {
  return {
    itemId: 'i', itemVersion: 1,
    outcome: o.outcome,
    correct: o.outcome === 'correct',
    isTimeout: o.outcome === 'timeout',
    score: null,
    presentedMonoMs: 0,
    firstInputMs: o.fi === undefined ? null : o.fi,
    responseMs: o.rt === undefined ? null : o.rt,
    pausedMs: o.paused || 0,
    rttMs: o.rtt === undefined ? null : o.rtt,
    corrections: 0,
    textLen: o.tl === undefined ? null : o.tl,
    vocabLevel: o.vl === undefined ? null : o.vl,
    category: o.cat === undefined ? null : o.cat,
    difficulty: null,
  };
}

test('numeric helpers are deterministic', () => {
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([5]), 5);
  assert.equal(median([]), null);

  assert.equal(weightedMean([{ value: 10, weight: 1 }, { value: 20, weight: 3 }]), 17.5);
  assert.equal(weightedMean([]), null);

  const pairs = [10, 20, 30, 40].map((value) => ({ value, weight: 1 }));
  assert.equal(weightedPercentile(pairs, 0.5), 20);
  assert.equal(weightedPercentile(pairs, 0.1), 10);
  assert.equal(weightedPercentile(pairs, 0.9), 40);
  assert.equal(weightedPercentile([], 0.5), null);

  assert.equal(weightedProportion(
    [{ weight: 1, x: true }, { weight: 1, x: false }, { weight: 2, x: true }],
    (t) => t.x,
  ), 0.75);
});

test('freshness weight decays with a 30-day half-life', () => {
  assert.equal(computeFreshnessWeight(100, 100, 30), 1);
  assert.equal(computeFreshnessWeight(0, 30 * DAY_MS, 30), 0.5);
  assert.equal(computeFreshnessWeight(0, undefined, 30), 1); // no clock → weight 1
});

test('estimateVocabLevel interpolates the 70% crossing', () => {
  const detail = new Map([
    ['3', { attempts: 10, weightedCorrect: 9, weightSum: 10 }], // .9
    ['4', { attempts: 10, weightedCorrect: 8, weightSum: 10 }], // .8
    ['5', { attempts: 10, weightedCorrect: 5, weightSum: 10 }], // .5
  ]);
  assert.ok(Math.abs(estimateVocabLevel(detail, 0.7) - (4 + 0.1 / 0.3)) < 1e-9);

  const allAbove = new Map([
    ['3', { attempts: 5, weightedCorrect: 5, weightSum: 5 }],
    ['4', { attempts: 5, weightedCorrect: 4, weightSum: 5 }],
  ]);
  assert.equal(estimateVocabLevel(allAbove, 0.7), 4); // cap at top tested level

  const allBelow = new Map([['2', { attempts: 5, weightedCorrect: 1, weightSum: 5 }]]);
  assert.equal(estimateVocabLevel(allBelow, 0.7), 1); // below the easiest tested level
  assert.equal(estimateVocabLevel(new Map(), 0.7), null);
});

test('computeTrend7d returns EWMA relative change and needs >= 2 points', () => {
  assert.equal(computeTrend7d([3, 4, 5]), 0.4167);
  assert.equal(computeTrend7d([5]), null);
  assert.equal(computeTrend7d([0, 1]), null); // zero base is undefined
});

test('computeAbilityMetrics derives the full §8.1 metric set', () => {
  const trials = [
    T({ outcome: 'correct', fi: 400, rt: 800, tl: 5, vl: 3, cat: 'animals' }),
    T({ outcome: 'correct', fi: 500, rt: 900, tl: 6, vl: 2, cat: 'animals' }),
    T({ outcome: 'wrong', fi: 600, rt: 1000, tl: 4, vl: 2, cat: 'science' }),
    T({ outcome: 'timeout', tl: 20, vl: 5, cat: 'science' }),
    T({ outcome: 'correct', fi: 200, rt: 500, tl: 10, vl: 4, cat: 'daily', paused: 1000 }),
  ];
  const { metrics, sampleTrials } = computeAbilityMetrics(trials, [280, 300, 320]);

  assert.equal(sampleTrials, 5);
  assert.equal(metrics.motor_baseline_ms, 300);
  assert.equal(metrics.reaction_p50_ms, 500);
  assert.equal(metrics.reaction_p10_ms, 400);
  assert.equal(metrics.reaction_p90_ms, 600);
  assert.equal(metrics.reading_speed_ms_per_char, 42.78);
  assert.equal(metrics.vocab_level_estimate, 4.3);
  assert.deepEqual(metrics.accuracy_by_level, { 2: 0.5, 3: 1, 4: 1, 5: 0 });
  assert.deepEqual(metrics.accuracy_by_category, { animals: 1, science: 0, daily: 1 });
  assert.equal(metrics.timeout_rate, 0.2);
  assert.equal(metrics.consistency, 0.0907);
  assert.equal(metrics.trend_7d, null); // filled by the orchestrator
  assert.equal(metrics.confidence, 'low'); // 5 < 30 sample threshold
});

test('computeAbilitySnapshot queries events, computes trend, and persists', async () => {
  const eventRows = [
    {
      event_type: 'ludellus.calibration_result',
      event_data: { trials: [{ first_input_ms: 280 }, { first_input_ms: 300 }, { first_input_ms: 320 }] },
      occurred_at: '2026-07-10T00:00:00.000Z', device_class: 'phone',
    },
    {
      event_type: 'ludellus.trial_result',
      event_data: {
        item_id: 'i1', item_version: 1, outcome: 'correct', presented_mono_ms: 0,
        first_input_ms: 400, response_ms: 800, paused_ms: 0,
        item_snapshot: { text_len: 5, vocab_level: 3, category: 'animals' },
      },
      occurred_at: '2026-07-10T00:01:00.000Z', device_class: 'phone',
    },
    {
      event_type: 'ludellus.trial_result',
      event_data: {
        item_id: 'i2', item_version: 1, outcome: 'wrong', presented_mono_ms: 0,
        first_input_ms: 700, response_ms: 1200, paused_ms: 0,
        item_snapshot: { text_len: 8, vocab_level: 4, category: 'science' },
      },
      occurred_at: '2026-07-10T00:02:00.000Z', device_class: 'phone',
    },
  ];

  const calls = [];
  let insertParams = null;
  const fakeDb = {
    query: async (text, params) => {
      calls.push({ text, params });
      if (text.includes('INSERT INTO player_ability_snapshots')) {
        insertParams = params;
        return {
          rows: [{
            id: 1, user_id: params[0], game_id: params[1], device_class: params[2],
            metrics: JSON.parse(params[3]), sample_trials: params[4],
            window_start: params[5], window_end: params[6], algo_version: params[7],
            computed_at: '2026-07-10T00:05:00.000Z',
          }],
        };
      }
      if (text.includes('FROM player_ability_snapshots')) return { rows: [{ value: 3.5 }] };
      if (text.includes('FROM play_events')) return { rows: eventRows };
      return { rows: [] };
    },
  };

  const snap = await computeAbilitySnapshot('u-1', 'ludellus', {
    database: fakeDb, now: '2026-07-10T00:05:00.000Z',
  });

  assert.equal(snap.userId, 'u-1');
  assert.equal(snap.gameId, 'ludellus');
  assert.equal(snap.deviceClass, 'phone');
  assert.equal(snap.sampleTrials, 2);
  assert.equal(snap.metrics.motor_baseline_ms, 300);
  assert.equal(snap.metrics.vocab_level_estimate, 3.3);
  assert.deepEqual(snap.metrics.accuracy_by_level, { 3: 1, 4: 0 });
  assert.equal(snap.metrics.trend_7d, -0.0286); // EWMA of [3.5, 3.3] vs base 3.5

  const eventsCall = calls.find((c) => c.text.includes('FROM play_events'));
  assert.equal(eventsCall.params[0], 'u-1');
  assert.equal(eventsCall.params[1], 'ludellus');
  assert.ok(Array.isArray(eventsCall.params[2]) && eventsCall.params[2].includes('ludellus.trial_result'));
  assert.ok(insertParams, 'snapshot was persisted');
});
