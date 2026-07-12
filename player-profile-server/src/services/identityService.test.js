const test = require('node:test');
const assert = require('node:assert/strict');
const { findOrCreateUser } = require('./identityService');

test('new user and identity are created in one transaction with allowlisted profile', async () => {
  const queries = [];
  const database = {
    async transaction(callback) {
      return callback({
        async query(sql, params) {
          queries.push({ sql, params });
          if (sql.startsWith('SELECT user_id')) return { rows: [] };
          return { rows: [] };
        },
      });
    },
  };
  const userId = await findOrCreateUser(
    'google',
    'sub-1',
    { displayName: 'Player', email: 'player@example.test', locale: 'ja' },
    { sub: 'sub-1', email: 'player@example.test', hd: 'blocked' },
    database
  );
  assert.match(userId, /^[0-9a-f-]{36}$/);
  assert.equal(queries.length, 3);
  const rawProfile = JSON.parse(queries[2].params[4]);
  assert.deepEqual(rawProfile, { sub: 'sub-1', email: 'player@example.test' });
});
