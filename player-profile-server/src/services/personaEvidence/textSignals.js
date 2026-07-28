// Shared deterministic text heuristics for evidence sources. Aspect-based
// analysis (aspectTextContributions.js) replaced the old narrative keyword
// lists in T4; the social keyword survives, polarity-gated, until
// sentiment-core grows a social aspect (Lapilli #14).
function clamp(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function textStrength(value, fullAt = 400) {
  return clamp(String(value || '').trim().length / fullAt);
}

function containsAny(values, terms) {
  const haystack = values.join(' ').toLowerCase();
  return terms.some((term) => haystack.includes(term));
}

const SOCIAL_TERMS = ['friend', 'multi', 'guild', 'coop', '友達', '協力', '対戦', '交流'];

module.exports = {
  SOCIAL_TERMS,
  clamp,
  containsAny,
  textStrength,
};
