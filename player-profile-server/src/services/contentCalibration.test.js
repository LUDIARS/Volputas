const test = require('node:test');
const assert = require('node:assert/strict');
const {
  computeContentStats,
  mergeContentStats,
  groupTrialsByItem,
  updateContentStatsForSession,
} = require('./contentCalibration');

const NOW = new Date('2026-07-10T00:00:00.000Z');

test('computeContentStats derives accuracy, response times and difficulty', () => {
  const stats = computeContentStats([
    { correct: true, isTimeout: false, responseMs: 1000 },
    { correct: true, isTimeout: false, responseMs: 2000 },
    { correct: false, isTimeout: false, responseMs: 3000 },
    { correct: false, isTimeout: true, responseMs: null },
  ], NOW);
  assert.equal(stats.attempts, 4);
  assert.equal(stats.correct, 2);
  assert.equal(stats.accuracy, 0.5);
  assert.equal(stats.avg_response_ms, 2000);
  assert.equal(stats.p50_response_ms, 2000);
  assert.equal(stats.timeout_rate, 0.25);
  assert.equal(stats.difficulty_observed, 0.5); // classical 1 − accuracy proxy
  assert.equal(stats.response_ms_count, 3);
  assert.equal(stats.timeout_count, 1);
  assert.equal(stats.calibrated_at, NOW.toISOString());
});

test('mergeContentStats folds new trials into a running average', () => {
  const existing = computeContentStats([
    { correct: true, isTimeout: false, responseMs: 1000 },
    { correct: true, isTimeout: false, responseMs: 2000 },
    { correct: false, isTimeout: false, responseMs: 3000 },
    { correct: false, isTimeout: true, responseMs: null },
  ], NOW);
  const merged = mergeContentStats(existing, [
    { correct: true, isTimeout: false, responseMs: 1000 },
    { correct: false, isTimeout: false, responseMs: 1000 },
  ], NOW);
  assert.equal(merged.attempts, 6);
  assert.equal(merged.correct, 3);
  assert.equal(merged.accuracy, 0.5);
  assert.equal(merged.avg_response_ms, 1600); // (6000 + 2000) / 5
  assert.equal(merged.timeout_rate, 0.1667);
  assert.equal(merged.p50_response_ms, 2000); // carried forward (median not incremental)
});

test('groupTrialsByItem keys by id+version and skips unmappable trials', () => {
  const groups = groupTrialsByItem([
    { itemId: 'i1', itemVersion: 1 },
    { itemId: 'i1', itemVersion: 1 },
    { itemId: 'i1', itemVersion: 2 },
    { itemId: null, itemVersion: 1 },
    { itemId: 'i2', itemVersion: null },
  ]);
  assert.equal(groups.size, 2);
  assert.equal(groups.get('i1 1').trials.length, 2);
  assert.equal(groups.get('i1 2').trials.length, 1);
});

test('updateContentStatsForSession only calibrates registered content items', async () => {
  const eventRows = [
    { event_type: 'ludellus.trial_result', event_data: { item_id: 'i1', item_version: 1, outcome: 'correct', response_ms: 1000 } },
    { event_type: 'ludellus.trial_result', event_data: { item_id: 'i1', item_version: 1, outcome: 'wrong', response_ms: 2000 } },
    { event_type: 'ludellus.trial_result', event_data: { item_id: 'i2', item_version: 1, outcome: 'correct', response_ms: 1500 } },
  ];
  const updates = [];
  const fakeDb = {
    query: async (text, params) => {
      if (text.includes('FROM play_events')) return { rows: eventRows };
      if (text.includes('SELECT stats FROM content_items')) {
        return { rows: params[0] === 'i1' ? [{ stats: {} }] : [] };
      }
      if (text.startsWith('UPDATE content_items')) {
        updates.push({ id: params[0], version: params[1], stats: JSON.parse(params[2]) });
        return { rowCount: 1 };
      }
      return { rows: [] };
    },
  };

  const result = await updateContentStatsForSession('sess-1', { database: fakeDb, now: NOW });
  assert.deepEqual(result, { items: 2, updated: 1, skipped: 1 });
  assert.equal(updates.length, 1);
  assert.equal(updates[0].id, 'i1');
  assert.equal(updates[0].version, 1);
  assert.equal(updates[0].stats.attempts, 2);
  assert.equal(updates[0].stats.correct, 1);
  assert.equal(updates[0].stats.accuracy, 0.5);
});
