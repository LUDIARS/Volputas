const MAX_EXCERPT_LENGTH = 300;
const MAX_TITLE_LENGTH = 120;
const MAX_AUTHOR_LENGTH = 80;

function sanitizeMentions(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/@(everyone|here)\b/gi, '@\u200b$1')
    .replace(/<@&?[^>]+>/g, (mention) => mention.replace('@', '@\u200b'));
}

function outboundText(value, maxLength) {
  return sanitizeMentions(value).slice(0, maxLength);
}

// reviewBaseUrl is the Volputas front end, not GLAB: the relayed link has to
// send readers back to the review as Volputas renders it.
function reviewUrl(reviewBaseUrl, glabProjectId) {
  const path = glabProjectId ? `/projects/${encodeURIComponent(glabProjectId)}/reviews` : '/reviews';
  return `${String(reviewBaseUrl || '').replace(/\/+$/, '')}${path}`;
}

function createReviewRelayService({ glabRelayClient, voiceStore, logger, reviewBaseUrl }) {
  if (!voiceStore || typeof voiceStore.markRelayed !== 'function') {
    throw new TypeError('voiceStore.markRelayed is required');
  }

  return {
    async relay(record) {
      if (record.visibility !== 'community') return { relayed: false, reason: 'not-community' };
      if (record.relayedAt) return { relayed: false, reason: 'already-relayed' };
      if (!glabRelayClient) return { relayed: false, reason: 'glab-unavailable' };

      try {
        const relayedAt = new Date().toISOString();
        await glabRelayClient.relayReview({
          reviewId: record.id,
          projectId: record.glabProjectId,
          gameTitle: outboundText(record.gameTitle, MAX_TITLE_LENGTH),
          recommend: record.recommend === true || record.recommend === false ? record.recommend : null,
          excerpt: outboundText(record.comment, MAX_EXCERPT_LENGTH),
          author: record.anonymous
            ? '\u533f\u540d'
            : outboundText(record.authorName, MAX_AUTHOR_LENGTH) || 'Player',
          url: reviewUrl(reviewBaseUrl, record.glabProjectId),
        });
        await voiceStore.markRelayed(record.id, relayedAt, record);
        return { relayed: true };
      } catch (error) {
        logger?.warn?.('Failed to relay GLab review to GLAB', {
          reviewId: record.id,
          error: error.message,
        });
        return { relayed: false, reason: 'relay-failed' };
      }
    },
  };
}

module.exports = { createReviewRelayService, sanitizeMentions };
