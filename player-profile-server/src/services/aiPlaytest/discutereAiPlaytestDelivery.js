const { aiPlaytestBridgeUrl, pushAiPlaytestReview } = require('./discutereAiPlaytestClient.mjs');

const BATCH_LIMIT = 25;
const LOG_LABEL = '[discutere-ai-playtest-push]';

/** @implements SPEC-VO-AI-PLAYTEST-REVIEWS */
function createDiscutereAiPlaytestDelivery({
  store, baseUrl, resolveBearer, fetchImpl, signal, warn = console.warn,
}) {
  function deferred(reason) {
    warn(`${LOG_LABEL} pending (reason=${reason})`);
    return { delivered: 0, reason };
  }

  return {
    async pushOnce() {
      if (!baseUrl) return deferred('base_url_missing');
      let url;
      try {
        url = aiPlaytestBridgeUrl(baseUrl);
      } catch {
        return deferred('base_url_invalid');
      }

      let reviews;
      try {
        reviews = await store.listPendingDelivery({ limit: BATCH_LIMIT });
      } catch {
        return deferred('list_failed');
      }
      if (!reviews.length) return { delivered: 0 };

      let bearer;
      try {
        bearer = await resolveBearer();
      } catch {
        return deferred('bearer_unavailable');
      }
      if (!bearer) return deferred('bearer_unavailable');

      let delivered = 0;
      for (const review of reviews) {
        if (signal?.aborted) break;
        const result = await pushAiPlaytestReview({ url, bearer, review, fetchImpl, signal });
        if (signal?.aborted) break;
        if (!result.delivered) {
          warn(`${LOG_LABEL} pending (review_id=${review.id}, reason=${result.reason})`);
        }
        try {
          await store.recordDeliveryAttempt(review.runId, result);
          if (result.delivered) delivered += 1;
        } catch {
          warn(`${LOG_LABEL} pending (review_id=${review.id}, reason=record_attempt_failed)`);
        }
      }
      return { delivered };
    },
  };
}

module.exports = { createDiscutereAiPlaytestDelivery };
