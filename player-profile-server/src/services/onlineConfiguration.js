function assertOnlineConfiguration(config) {
  const required = [
    ['CERNERE_BASE_URL', config.cernere.baseUrl],
    ['CERNERE_PROJECT_CLIENT_ID', config.cernere.projectClientId],
    ['CERNERE_PROJECT_CLIENT_SECRET', config.cernere.projectClientSecret],
    ['CERNERE_OIDC_CLIENT_ID', config.oauth.cernere.clientId],
    ['CERNERE_OIDC_CLIENT_SECRET', config.oauth.cernere.clientSecret],
    ['CERNERE_OIDC_CALLBACK_URL', config.oauth.cernere.callbackUrl],
  ];
  const missing = required.filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) {
    throw Object.assign(
      new Error(`Online mode configuration is missing: ${missing.join(', ')}`),
      { code: 'ONLINE_CONFIG_MISSING' }
    );
  }
}

module.exports = { assertOnlineConfiguration };
