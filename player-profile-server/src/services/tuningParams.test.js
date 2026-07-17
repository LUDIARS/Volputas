const test = require('node:test');
const assert = require('node:assert/strict');
const { getTuningParams, tuningParamsView } = require('./tuningParams');

test('tuningParamsView maps a row to a camelCase view', () => {
  const view = tuningParamsView({
    user_id: 'u-1',
    game_id: 'ludellus',
    tuning_version: 12,
    params: { time_limit_ms: 6500, vocab_level_range: [4, 6] },
    based_on_snapshot: 42,
    computed_at: '2026-07-02T00:00:00.000Z',
  });
  assert.deepEqual(view, {
    userId: 'u-1',
    gameId: 'ludellus',
    tuningVersion: 12,
    params: { time_limit_ms: 6500, vocab_level_range: [4, 6] },
    basedOnSnapshot: 42,
    computedAt: '2026-07-02T00:00:00.000Z',
  });
});

test('tuningParamsView is null-safe and defaults optional fields', () => {
  assert.equal(tuningParamsView(null), null);
  const sparse = tuningParamsView({ user_id: 'u', game_id: 'g' });
  assert.deepEqual(sparse.params, {});
  assert.equal(sparse.basedOnSnapshot, null);
});

test('getTuningParams queries by user + game and returns the view', async () => {
  const calls = [];
  const fakeDb = {
    query: async (text, params) => {
      calls.push({ text, params });
      return {
        rows: [{
          user_id: 'u-1',
          game_id: 'ludellus',
          tuning_version: 3,
          params: { preset: 'normal' },
          based_on_snapshot: 7,
          computed_at: '2026-07-10T00:00:00.000Z',
        }],
      };
    },
  };
  const view = await getTuningParams('u-1', 'ludellus', fakeDb);
  assert.equal(view.tuningVersion, 3);
  assert.equal(view.basedOnSnapshot, 7);
  assert.deepEqual(view.params, { preset: 'normal' });
  assert.deepEqual(calls[0].params, ['u-1', 'ludellus']);
  assert.match(calls[0].text, /FROM player_tuning_params/);
});

test('getTuningParams returns null when no row exists', async () => {
  const fakeDb = { query: async () => ({ rows: [] }) };
  assert.equal(await getTuningParams('nobody', 'ludellus', fakeDb), null);
});
