const { normalizeOptionalBaseUrl } = require('./baseUrl');

/** @implements SPEC-VO-CC-MANAGEMENT-EVENTS */
function managementEventsUrl(env, { hasterEnabled, localMode = false }) {
  if (hasterEnabled || localMode) return null;

  const endpoint = env.CONCORDIA_MANAGEMENT_EVENTS_URL?.trim();
  if (endpoint) {
    return endpoint.toLowerCase() === 'off' ? null
      : normalizeOptionalBaseUrl(endpoint, 'CONCORDIA_MANAGEMENT_EVENTS_URL');
  }

  const base = env.CONCORDIA_URL?.trim();
  if (!base || base.toLowerCase() === 'off') return null;
  return new URL('/v1/management/events', normalizeOptionalBaseUrl(base, 'CONCORDIA_URL')).href;
}

module.exports = { managementEventsUrl };
