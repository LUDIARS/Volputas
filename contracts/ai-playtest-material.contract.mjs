const FIELDS = [
  'bad', 'confusions', 'game_id', 'game_title', 'good', 'origin', 'played_at',
  'reflection', 'run_id', 'source', 'summary',
];

export default {
  post: (material, review) => {
    return (
      Object.keys(material).sort().join(',') === FIELDS.join(',')
      && material.origin === 'ai'
      && material.source === 'ai-autoplayer'
      && material.run_id === review.runId
      && material.game_id === review.gameId
      && material.summary === review.summary
    ) || 'AI material must use the allowlist, keep its run and game keys, and declare its origin';
  },
};
