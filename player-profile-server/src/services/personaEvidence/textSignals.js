// Shared deterministic text heuristics for evidence sources (v1 parity).
// T4 replaces keyword matching with sentiment-core aspects; until then these
// stay byte-compatible with the v1 analyzer.
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

const NARRATIVE_TERMS = ['story', 'narrative', '物語', 'ストーリー', '世界観', 'キャラ'];
const SOCIAL_TERMS = ['friend', 'multi', 'guild', 'coop', '友達', '協力', '対戦', '交流'];
const SURVEY_NARRATIVE_TERMS = ['story', 'narrative', '物語', 'ストーリー'];
const SURVEY_SOCIAL_TERMS = ['social', 'friend', 'multi', '友達', '協力', '対戦'];

module.exports = {
  NARRATIVE_TERMS,
  SOCIAL_TERMS,
  SURVEY_NARRATIVE_TERMS,
  SURVEY_SOCIAL_TERMS,
  clamp,
  containsAny,
  textStrength,
};
