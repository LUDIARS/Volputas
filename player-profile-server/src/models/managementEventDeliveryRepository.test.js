const test = require('node:test');
const assert = require('node:assert/strict');
const { createManagementEventDeliveryRepository } = require('./managementEventDeliveryRepository');

test('delivery queries use saved reviews and only read metadata for ready human impressions', async () => {
  const queries = [];
  const row = { id: 'stored-impression' };
  const repository = createManagementEventDeliveryRepository({
    async query(sql, params) {
      queries.push({ sql, params });
      return { rows: [row] };
    },
  });

  assert.deepEqual(await repository.listPendingAi(25), [row]);
  assert.deepEqual(await repository.listPendingHuman(25), [row]);
  assert.match(queries[0].sql, /FROM ai_playtest_reviews r/);
  assert.match(queries[1].sql, /SELECT i\.id, s\.game_id, i\.captured_at, i\.created_at/);
  assert.match(queries[1].sql, /JOIN play_sessions s ON s\.id = i\.session_id/);
  assert.match(queries[1].sql, /i\.status = 'ready' AND i\.deleted_at IS NULL/);
  for (const { sql, params } of queries) {
    assert.match(sql, /d\.state IS NULL OR d\.state = 'pending'/);
    assert.match(sql, /ORDER BY d\.attempted_at NULLS FIRST/);
    assert.deepEqual(params, [25]);
  }
});

test('recording a late attempt cannot reopen a terminal delivery or update a source impression', async () => {
  const repository = createManagementEventDeliveryRepository({
    async query(sql, params) {
      assert.match(sql, /INSERT INTO cc_management_event_delivery/);
      assert.match(sql, /ON CONFLICT \(origin, source_id\) DO UPDATE/);
      assert.match(sql, /WHERE cc_management_event_delivery\.state = 'pending'/);
      assert.deepEqual(params, ['human', 'stored-impression', 'pending', 503]);
    },
  });
  await repository.recordAttempt('human', 'stored-impression', { state: 'pending', status: 503 });
});
