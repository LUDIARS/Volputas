const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPersonaExports } = require('./personaExport');

test('persona export exposes only a pseudonymous user_id and derived profile data', () => {
  const internalUserId = '6f1d0b9b-179a-4fc7-a643-d3228fe350b2';
  const result = buildPersonaExports(
    [{
      user_id: internalUserId,
      affect_vector: Array(20).fill(0.25),
      vector_spec_version: 1,
      playstyle_tags: ['探索型', '協力重視', '探索型'],
      display_name: 'must not leak',
      email: 'must-not-leak@example.com',
    }],
    'test-secret'
  );
  assert.equal(result.personas.length, 1);
  assert.match(result.personas[0].user_id, /^ext:voluptas:[0-9a-f]{16}$/);
  assert.notEqual(result.personas[0].user_id, internalUserId);
  assert.deepEqual(result.personas[0].traits, ['探索型', '協力重視']);
  assert.equal('display_name' in result.personas[0], false);
  assert.equal('email' in result.personas[0], false);
});

test('persona export skips unsupported or malformed affect vectors', () => {
  const result = buildPersonaExports(
    [
      { user_id: 'a', affect_vector: [0], vector_spec_version: 1 },
      { user_id: 'b', affect_vector: Array(20).fill(0), vector_spec_version: 2 },
    ],
    'test-secret'
  );
  assert.deepEqual(result, { personas: [] });
});
