const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizePlaySession, median } = require('./playSessionSummary');

function trial(itemId, attempt, outcome, responseMs, sinceWrongMs) {
  const data = { item_id: itemId, attempt, outcome, response_ms: responseMs };
  if (sinceWrongMs !== undefined) data.since_wrong_ms = sinceWrongMs;
  return { event_type: 'ludellus.trial_result', event_data: data };
}

test('computes first-try accuracy per item and timing medians (SPEC-VO-PLAY-STREAM-SUMMARY)', () => {
  const summary = summarizePlaySession({
    startedAt: '2026-11-21T10:00:00.000Z',
    endedAt: new Date('2026-11-21T10:01:00.000Z'),
    reason: 'completed',
    events: [
      trial('q1', 1, 'correct', 900),
      trial('q2', 1, 'wrong', 1500),
      trial('q2', 2, 'correct', 2500, 1000),
      trial('q3', 1, 'timeout', null),
      trial('q3', 2, 'wrong', 6000, 1000),
      trial('q3', 3, 'correct', 7000, 3000),
      { event_type: 'ludellus.metric', event_data: { name: 'combo', value: 2 } },
      { event_type: 'ludellus.metric', event_data: { name: 'combo', value: 1 } },
      { event_type: 'ludellus.session_summary', event_data: {} },
    ],
  });
  assert.deepEqual(summary, {
    v: 1,
    reason: 'completed',
    duration_ms: 60_000,
    answers: 6,
    correct: 3,
    wrong: 2,
    timeouts: 1,
    items: 3,
    first_try_correct: 1,
    first_try_accuracy: 1 / 3,
    response_ms_median: 1200,
    since_wrong_ms_median: 1000,
    metrics: { combo: { count: 2, sum: 3, min: 1, max: 2, last: 1 } },
  });
});

test('treats a trial without attempt as a first answer and returns null rates when empty', () => {
  const legacy = summarizePlaySession({
    startedAt: '2026-11-21T10:00:00.000Z', endedAt: '2026-11-21T10:00:10.000Z', reason: 'abandoned',
    events: [{ event_type: 'ludellus.trial_result', event_data: { item_id: 'a', outcome: 'correct', response_ms: 500 } }],
  });
  assert.equal(legacy.first_try_accuracy, 1);
  const empty = summarizePlaySession({ startedAt: '2026-11-21T10:00:00.000Z', endedAt: '2026-11-21T10:00:10.000Z', reason: 'abandoned', events: [] });
  assert.equal(empty.first_try_accuracy, null);
  assert.equal(empty.response_ms_median, null);
});

test('median skips missing values and averages the middle pair', () => {
  assert.equal(median([4, null, 1, 3, 2]), 2.5);
  assert.equal(median([null]), null);
});
