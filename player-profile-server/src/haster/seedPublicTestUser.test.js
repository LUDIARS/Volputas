const test = require('node:test');
const assert = require('node:assert/strict');

const {
  HASTER_PUBLIC_TEST_CERNERE_SUB,
  HASTER_PUBLIC_TEST_DISCORD_ID,
  HASTER_PUBLIC_TEST_USER_ID,
} = require('./publicTestIdentity');
const { seedHasterPublicTestUser } = require('./seedPublicTestUser');

test('HASTER seed is idempotent and records verified public identities', async () => {
  const queries = [];
  const database = {
    async transaction(callback) {
      return callback({
        async query(sql, params) {
          queries.push({ sql, params });
        },
      });
    },
  };
  await seedHasterPublicTestUser(database);
  assert.equal(queries.length, 3);
  assert.match(queries[0].sql, /ON CONFLICT \(id\) DO UPDATE/);
  assert.match(queries[0].sql, /discussion_import_consent = true/);
  assert.deepEqual(queries[0].params, [HASTER_PUBLIC_TEST_USER_ID]);
  assert.match(queries[1].sql, /verified_at = now\(\)/);
  assert.deepEqual(queries[1].params.slice(0, 2), [
    HASTER_PUBLIC_TEST_USER_ID,
    HASTER_PUBLIC_TEST_DISCORD_ID,
  ]);
  assert.match(queries[2].sql, /'cernere'/);
  assert.match(queries[2].sql, /verified_at = now\(\)/);
  assert.deepEqual(queries[2].params.slice(0, 2), [
    HASTER_PUBLIC_TEST_USER_ID,
    HASTER_PUBLIC_TEST_CERNERE_SUB,
  ]);
});
