const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../config/database');
const userModel = require('./userModel');

test('user settings persist explicit research export consent', async (t) => {
  const originalQuery = db.query;
  const queries = [];
  db.query = async (sql, params) => {
    queries.push({ sql, params });
    return {
      rows: [{
        id: 'user-1',
        display_name: 'Researcher',
        research_export_consent: true,
      }],
    };
  };
  t.after(() => { db.query = originalQuery; });

  const user = await userModel.update('user-1', { researchExportConsent: true });
  assert.equal(user.research_export_consent, true);
  assert.match(queries[0].sql, /research_export_consent = \$1/);
  assert.deepEqual(queries[0].params, [true, 'user-1']);
});

test('account soft deletion revokes delegations and cancels pending claims transactionally', async (t) => {
  const originalTransaction = db.transaction;
  const queries = [];
  db.transaction = async (callback) => callback({
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.startsWith('UPDATE users')) return { rowCount: 1, rows: [] };
      if (sql.includes('UPDATE profile_delegation_grants')) {
        return { rows: [{ id: 'grant-1', subject_user_id: 'subject-1' }] };
      }
      return { rows: [] };
    },
  });
  t.after(() => { db.transaction = originalTransaction; });

  const now = new Date('2026-07-13T00:00:00.000Z');
  assert.equal(await userModel.softDelete('user-1', now), true);
  assert.equal(queries.some((entry) => entry.sql.includes("status = 'revoked'")), true);
  assert.equal(queries.some((entry) => entry.sql.includes("status = 'cancelled'")), true);
  assert.equal(queries.some((entry) => entry.sql.includes('delegation.account_revoked')), true);
  assert.equal(queries.every((entry) => !JSON.stringify(entry.params).includes('proposed_value')), true);
});
