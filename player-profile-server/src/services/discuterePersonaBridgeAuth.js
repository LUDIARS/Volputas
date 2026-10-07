const config = require('../config');
const { CernereServiceTokenClient } = require('../integrations/cernere/serviceTokenClient');
const { createServiceBearerResolver } = require('../integrations/cernere/serviceBearerResolver');

// Discutere authorizes the bridge with the `persona-bridge:write` scope that
// Cernere derives from Voluptas' service_scopes declaration.

let sharedResolver = null;

/**
 * Process-wide bearer resolver for Discutere persona bridge calls, so the
 * bridge client and the discussion publisher share one cached service token.
 * @implements SPEC-AUTH-P4-SERVICE-TOKEN
 */
function discuterePersonaBridgeBearer() {
  if (!sharedResolver) {
    sharedResolver = createServiceBearerResolver({
      tokenClient: new CernereServiceTokenClient({
        baseUrl: config.cernere.baseUrl,
        clientId: config.cernere.projectClientId,
        clientSecret: config.cernere.projectClientSecret,
        targetProjectKey: config.discuterePersonaBridge.cernereProjectKey,
      }),
      fallbackToken: config.discuterePersonaBridge.token,
      label: 'discutere-persona-bridge',
    });
  }
  return sharedResolver;
}

module.exports = {
  discuterePersonaBridgeBearer,
};
