const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPlayStreamStats } = require('./playStreamStats');

function row(id, gameId, endedAt, summary) {
  return { id, game_id: gameId, started_at: new Date('2026-11-21T09:00:00.000Z'), ended_at: new Date(endedAt), summary };
}

test('groups sessions by game with item-weighted first-try accuracy (SPEC-VO-PLAY-STREAM-STATS)', () => {
  const stats = buildPlayStreamStats([
    row('s3', 'uni-math', '2026-11-21T12:00:00.000Z', {
      reason: 'completed', duration_ms: 60_000, answers: 12, correct: 10, wrong: 2, timeouts: 0, items: 10,
      first_try_correct: 8, response_ms_median: 1000, since_wrong_ms_median: 500, metrics: { combo: { count: 2, sum: 5, min: 2, max: 3, last: 3 } },
    }),
    row('s2', 'uni-kotoba', '2026-11-21T11:00:00.000Z', {
      reason: 'abandoned', duration_ms: 10_000, answers: 1, correct: 0, wrong: 1, timeouts: 0, items: 1,
      first_try_correct: 0, response_ms_median: 4000, since_wrong_ms_median: null, metrics: {},
    }),
    row('s1', 'uni-math', '2026-11-21T10:00:00.000Z', {
      reason: 'completed', duration_ms: 30_000, answers: 2, correct: 2, wrong: 0, timeouts: 0, items: 2,
      first_try_correct: 2, response_ms_median: 2000, since_wrong_ms_median: null, metrics: { combo: { count: 1, sum: 1, min: 1, max: 1, last: 1 } },
    }),
  ]);
  assert.deepEqual(stats.games.map((game) => game.game_id), ['uni-math', 'uni-kotoba']);
  const math = stats.games[0];
  assert.equal(math.sessions, 2);
  assert.equal(math.completed, 2);
  assert.equal(math.total_duration_ms, 90_000);
  assert.equal(math.items, 12);
  assert.equal(math.first_try_accuracy, 10 / 12);
  assert.equal(math.response_ms_median, 1500);
  assert.equal(math.since_wrong_ms_median, 500);
  assert.deepEqual(math.metrics, { combo: { count: 3, sum: 6, min: 1, max: 3 } });
  assert.equal(math.last_played_at, '2026-11-21T12:00:00.000Z');
  assert.deepEqual(stats.recent.map((entry) => entry.session_id), ['s3', 's2', 's1']);
  assert.equal(stats.recent[1].first_try_accuracy, null);
});

test('returns empty lists when nothing was played', () => {
  assert.deepEqual(buildPlayStreamStats([]), { games: [], recent: [] });
});
