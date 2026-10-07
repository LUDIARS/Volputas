const test = require('node:test');
const assert = require('node:assert/strict');
const { applyLegacyEnvAliases } = require('./legacyEnvAliases');

test('reads legacy VOLPUTAS_* names as VOLUPTAS_*', () => {
  const env = applyLegacyEnvAliases({ VOLPUTAS_URL: 'http://legacy', OTHER: 'x' });
  assert.equal(env.VOLUPTAS_URL, 'http://legacy');
  assert.equal(env.OTHER, 'x');
});

test('keeps the new name when both are set', () => {
  const env = applyLegacyEnvAliases({ VOLPUTAS_DATABASE_URL: 'old', VOLUPTAS_DATABASE_URL: 'new' });
  assert.equal(env.VOLUPTAS_DATABASE_URL, 'new');
});
