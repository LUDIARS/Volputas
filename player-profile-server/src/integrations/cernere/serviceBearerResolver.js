// P4 migration sender policy: prefer a Cernere service token, and fall back to
// the legacy fixed token only when issuance fails. Remove the fallback in P5.

const { ServiceTokenIssueError } = require('./serviceTokenClient');

/**
 * Builds `() => Promise<string>` resolving the bearer value for one outbound
 * integration. Logs only the reason code, never a token or credential.
 * @implements SPEC-AUTH-P4-SERVICE-TOKEN
 */
function createServiceBearerResolver({
  tokenClient,
  fallbackToken = '',
  label,
  warn = console.warn,
}) {
  return async function resolveServiceBearer() {
    try {
      return await tokenClient.getToken();
    } catch (error) {
      if (!(error instanceof ServiceTokenIssueError)) throw error;
      if (!fallbackToken) throw error;
      warn(`[${label}] service token unavailable (reason=${error.reason}); using legacy fixed token`);
      return fallbackToken;
    }
  };
}

module.exports = {
  createServiceBearerResolver,
};
