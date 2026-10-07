const test = require('node:test');
const assert = require('node:assert/strict');

const CONFIG_ENVIRONMENT_KEYS = [
  'VOLUPTAS_ENVIRONMENT',
  'VOLUPTAS_PERSONA_EXPORT_TOKEN',
  'VOLUPTAS_PSEUDO_ID_SECRET',
  'VOLPUTAS_PSEUDO_ID_SECRET',
];

function loadConfig(environment) {
  const originalValues = new Map(
    CONFIG_ENVIRONMENT_KEYS.map((key) => [key, process.env[key]])
  );
  const configPath = require.resolve('./index');
  try {
    for (const key of CONFIG_ENVIRONMENT_KEYS) delete process.env[key];
    Object.assign(process.env, environment);
    delete require.cache[configPath];
    return require('./index');
  } finally {
    delete require.cache[configPath];
    for (const [key, value] of originalValues) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('HASTER config uses public bridge fixtures only when values are absent', () => {
  const config = loadConfig({ VOLUPTAS_ENVIRONMENT: 'HASTER' });

  assert.equal(config.personaExport.token, 'haster-public-persona-export-token-v1');
  assert.equal(config.pseudoIdSecret, 'haster-public-pseudo-id-secret-v1');
});

test('bridge config prefers canonical explicit values and has no non-HASTER fallback', () => {
  const configured = loadConfig({
    VOLUPTAS_ENVIRONMENT: 'HASTER',
    VOLUPTAS_PERSONA_EXPORT_TOKEN: 'configured-persona-token',
    VOLUPTAS_PSEUDO_ID_SECRET: 'canonical-secret',
    VOLPUTAS_PSEUDO_ID_SECRET: 'legacy-secret',
  });
  const unconfigured = loadConfig({});

  assert.equal(configured.personaExport.token, 'configured-persona-token');
  assert.equal(configured.pseudoIdSecret, 'canonical-secret');
  assert.equal(unconfigured.personaExport.token, '');
  assert.equal(unconfigured.pseudoIdSecret, '');
});
