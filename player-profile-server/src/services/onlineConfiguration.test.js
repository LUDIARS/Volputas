const test = require('node:test');
const assert = require('node:assert/strict');
const { assertOnlineConfiguration } = require('./onlineConfiguration');

function configuration(overrides = {}) {
  return {
    cernere: {
      baseUrl: 'https://cernere.example.test',
      projectClientId: 'volputas-client',
      projectClientSecret: 'project-secret',
      ...overrides.cernere,
    },
    oauth: {
      cernere: {
        clientId: 'oidc-client',
        clientSecret: 'oidc-secret',
        callbackUrl: 'https://volputas.example.test/auth/callback',
        ...overrides.oauth,
      },
    },
  };
}

test('online configuration requires both project and user authentication credentials', () => {
  assert.doesNotThrow(() => assertOnlineConfiguration(configuration()));
  assert.throws(
    () => assertOnlineConfiguration(configuration({
      cernere: { projectClientSecret: '' },
      oauth: { clientId: '' },
    })),
    (error) => error.code === 'ONLINE_CONFIG_MISSING'
      && error.message.includes('CERNERE_PROJECT_CLIENT_SECRET')
      && error.message.includes('CERNERE_OIDC_CLIENT_ID')
  );
});
