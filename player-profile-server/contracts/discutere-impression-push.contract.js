// Contract C-2: one push never throws and only reports a fixed outcome vocabulary.
const OUTCOMES = new Set(['pushed', 'not_configured', 'bearer_unavailable', 'nothing_to_push', 'failed']);

module.exports = {
  post: (result, deps) => {
    if (!result || !OUTCOMES.has(result.outcome)) return `unknown outcome: ${result?.outcome}`;
    if (result.outcome !== 'pushed' && result.pushed !== 0) return 'non-pushed outcomes must report pushed=0';
    if (result.outcome === 'pushed') {
      if (!(result.pushed > 0)) return 'pushed outcome must send at least one impression';
      if (!result.ids.every((id) => deps.sentIds.has(id))) return 'pushed ids must be recorded as sent';
    }
    return true;
  },
};
