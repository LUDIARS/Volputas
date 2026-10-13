const DEFAULT_INTERVAL_MINUTES = 15;
const MIN_INTERVAL_MINUTES = 1;
const MAX_INTERVAL_MINUTES = 1440;

/**
 * Settings for the periodic anonymous impression push to Discutere.
 * Providing impressions is an obligation, so it runs unless explicitly disabled.
 * @implements SPEC-GLAB-IMPRESSION-EXPORT
 */
function discutereImpressionPushConfig(env) {
  const parsed = Number.parseInt(env.DISCUTERE_IMPRESSION_PUSH_INTERVAL_MINUTES ?? '', 10);
  const interval = Number.isSafeInteger(parsed) ? parsed : DEFAULT_INTERVAL_MINUTES;
  return {
    enabled: env.DISCUTERE_IMPRESSION_PUSH_ENABLED !== 'false',
    intervalMinutes: Math.min(MAX_INTERVAL_MINUTES, Math.max(MIN_INTERVAL_MINUTES, interval)),
  };
}

module.exports = { discutereImpressionPushConfig };
