const test = require('node:test');
const assert = require('node:assert/strict');

const {
  assertHasterConfiguration,
  deriveHasterDatabaseUrl,
} = require('./environment');

test('HASTER derives an isolated database name', () => {
  const url = deriveHasterDatabaseUrl('postgres://user:pass@localhost:5432/volputas');
  assert.equal(new URL(url).pathname, '/volputas_haster');
  assert.equal(
    deriveHasterDatabaseUrl('postgres://user:pass@localhost:5432/volputas_haster'),
    'postgres://user:pass@localhost:5432/volputas_haster'
  );
});

test('HASTER refuses production and non-isolated configuration', () => {
  const base = {
    haster: { enabled: true },
    nodeEnv: 'development',
    frontendUrl: 'http://localhost:18892',
    jwt: { issuer: 'http://localhost:18892' },
    db: { connectionString: 'postgres://localhost/volputas_haster' },
  };
  assert.doesNotThrow(() => assertHasterConfiguration(base));
  assert.throws(
    () => assertHasterConfiguration({ ...base, nodeEnv: 'production' }),
    /must never run/
  );
  assert.throws(
    () => assertHasterConfiguration({ ...base, frontendUrl: 'https://example.test' }),
    /loopback frontend/
  );
  assert.throws(
    () => assertHasterConfiguration({
      ...base,
      jwt: { issuer: 'https://example.test' },
    }),
    /loopback frontend/
  );
  assert.throws(
    () => assertHasterConfiguration({
      ...base,
      db: { connectionString: 'postgres://localhost/volputas' },
    }),
    /_haster/
  );
});
