const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('research export consent migration is idempotent and defaults closed', () => {
  const sql = fs.readFileSync(
    path.resolve(__dirname, '../../migrations/014_persona_export_consent.sql'),
    'utf8'
  );
  assert.match(sql, /ADD COLUMN IF NOT EXISTS research_export_consent/i);
  assert.match(sql, /BOOLEAN NOT NULL DEFAULT false/i);
  assert.doesNotMatch(sql, /DEFAULT true/i);
});
