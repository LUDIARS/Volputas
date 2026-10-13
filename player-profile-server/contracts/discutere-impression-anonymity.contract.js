// Contract C-1 (spec/feature/glab-impression-export.md, Discutere への自動送信).
// Anonymity is the obligation: only the six allowlisted fields may leave Voluptas.
const ALLOWED = ['id', 'gameTitle', 'recommend', 'polarity', 'comment', 'createdAt'];

module.exports = {
  post: (result) => {
    if (!result || typeof result !== 'object') return 'impression must be an object';
    const keys = Object.keys(result).sort();
    return (keys.length === ALLOWED.length && keys.every((key, i) => key === [...ALLOWED].sort()[i]))
      || `impression carries fields outside the allowlist: ${keys.join(',')}`;
  },
};
