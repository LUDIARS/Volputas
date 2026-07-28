const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('discussion return migration defaults closed and does not trust old identities', () => {
  const sql = fs.readFileSync(
    path.resolve(__dirname, '../../migrations/015_discussion_import_consent.sql'),
    'utf8'
  );
  assert.match(sql, /discussion_import_consent BOOLEAN NOT NULL DEFAULT false/i);
  assert.match(sql, /verified_at TIMESTAMPTZ/i);
  assert.doesNotMatch(sql, /UPDATE federated_identities/i);
});
