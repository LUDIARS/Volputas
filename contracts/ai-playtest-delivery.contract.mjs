export default {
  post: (result, { url, bearer, review }) => {
    if (!url || !bearer) return !result.delivered || 'delivery requires bridge configuration';
    if (result.delivered) {
      return (
        url.pathname.endsWith('/api/persona-bridge/ai-playtest-reviews')
        && result.receipt?.ok === true
        && result.receipt?.run_id === review.runId
      ) || 'delivery requires an acknowledgment for this run from the AI endpoint';
    }
    return typeof result.reason === 'string' && result.reason.length > 0;
  },
};
