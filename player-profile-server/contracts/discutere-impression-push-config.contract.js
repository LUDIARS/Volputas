// Contract C-3: providing impressions is an obligation, so it runs unless explicitly disabled.
module.exports = {
  post: (result, env = {}) => {
    if (result.enabled !== (env.DISCUTERE_IMPRESSION_PUSH_ENABLED !== 'false')) return 'enabled must be false only for "false"';
    if (!Number.isInteger(result.intervalMinutes)) return 'intervalMinutes must be an integer';
    return (result.intervalMinutes >= 1 && result.intervalMinutes <= 1440) || 'intervalMinutes must be clamped to 1..1440';
  },
};
