const test = require('node:test');
const assert = require('node:assert/strict');
const { createDelegationRepository } = require('./delegationRepository');

function recordingDatabase() {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [] };
    },
  };
  return {
    calls,
    async query(sql, params) { return client.query(sql, params); },
    async transaction(callback) { return callback(client); },
  };
}

test('accepted claim application uses parameterized canonical profile updates', async () => {
  const database = recordingDatabase();
  const repository = createDelegationRepository(database);
  await repository.applyAcceptedClaim({
    subject_user_id: '11111111-1111-4111-8111-111111111111',
    field: 'playstyle_tags',
    proposed_value: ['gamer_johnny'],
  });
  await repository.applyAcceptedClaim({
    subject_user_id: '11111111-1111-4111-8111-111111111111',
    field: 'preference.style.explorer',
    proposed_value: 0.75,
  });
  assert.equal(database.calls.length, 2);
  assert.match(database.calls[0].sql, /ON CONFLICT \(user_id\)/);
  assert.deepEqual(database.calls[0].params[1], ['gamer_johnny']);
  assert.equal(database.calls[1].params[1], 'style.explorer');
  assert.equal(database.calls[1].params[2], 0.75);
  assert.equal(database.calls[1].sql.includes('style.explorer'), false, 'axis is not interpolated into SQL');
});

test('audit persistence contains metadata parameters but never SQL-interpolates values', async () => {
  const database = recordingDatabase();
  const repository = createDelegationRepository(database);
  await repository.insertAudit({
    grantId: 'grant',
    subjectUserId: 'subject',
    actorUserId: 'actor',
    action: 'claims.proposed',
    metadata: { fields: ['playstyle_tags'], count: 1 },
    now: new Date('2026-07-13T00:00:00.000Z'),
  });
  assert.equal(database.calls[0].sql.includes('playstyle_tags'), false);
  assert.deepEqual(JSON.parse(database.calls[0].params[5]), { fields: ['playstyle_tags'], count: 1 });
});
