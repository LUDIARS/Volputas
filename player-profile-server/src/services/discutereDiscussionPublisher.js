const { createHash } = require('node:crypto');
const { normalizeBridgeBaseUrl } = require('./discussionBridgeClient');

/** @implements SPEC-VOLPUTAS-DISCUTERE-REVIEW-DISCUSSION */
function publicationError(message, code, statusCode) {
  return Object.assign(new Error(message), { code, statusCode });
}

/** @implements SPEC-VOLPUTAS-DISCUTERE-REVIEW-DISCUSSION */
function discuterePersonaId(pseudoId) {
  if (typeof pseudoId !== 'string' || !/^ext:voluptas:[0-9a-f]{16}$/.test(pseudoId)) {
    throw new TypeError('Voluptas persona pseudoId is invalid');
  }
  const digest = createHash('sha256').update(pseudoId, 'utf8').digest('hex').slice(0, 16);
  return `persona:voluptas:${digest}`;
}

/** @implements SPEC-VOLPUTAS-DISCUTERE-REVIEW-DISCUSSION */
function validSessionId(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

class DiscutereDiscussionPublisher {
  /** @implements SPEC-VOLPUTAS-DISCUTERE-REVIEW-DISCUSSION */
  constructor({ baseUrl, token, fetchImpl = fetch, timeoutMs = 15_000 }) {
    this.baseUrl = baseUrl;
    this.token = token;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  /** @implements SPEC-VOLPUTAS-DISCUTERE-REVIEW-DISCUSSION */
  async publish({ persona, review }) {
    if (!this.baseUrl || typeof this.token !== 'string' || this.token.length < 32) {
      throw publicationError(
        'Discutere persona bridge is not configured',
        'DISCUTERE_DISCUSSION_UNAVAILABLE',
        503
      );
    }
    const personaId = discuterePersonaId(persona?.pseudoId);
    const imported = await this.#post('api/admin/personas/import', { personas: [persona] });
    if (imported.ok !== true || imported.imported !== 1 || imported.skipped !== 0) {
      throw publicationError(
        'Discutere rejected the Voluptas persona',
        'DISCUTERE_PERSONA_IMPORT_REJECTED',
        502
      );
    }

    const discussion = await this.#post('api/flow/start', {
      gameTitle: review.gameTitle,
      discussionTheme: `${review.gameTitle}の感想を掘り下げる`,
      discussionContent: [
        `本人の評価: ${review.rating}/5`,
        '',
        '本人の感想:',
        review.text,
      ].join('\n'),
      flow: 'discussion',
      tags: [],
      personaIds: [personaId],
    });
    if (discussion.ok !== true || !validSessionId(discussion.sessionId)) {
      throw publicationError(
        'Discutere returned an invalid discussion response',
        'DISCUTERE_DISCUSSION_RESPONSE_INVALID',
        502
      );
    }
    return {
      sessionId: discussion.sessionId,
      reviewRequired: discussion.review === true,
    };
  }

  /** @implements SPEC-VOLPUTAS-DISCUTERE-REVIEW-DISCUSSION */
  async #post(pathname, body) {
    const baseUrl = normalizeBridgeBaseUrl(this.baseUrl);
    const url = new URL(pathname, baseUrl);
    let response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw publicationError(
        'Discutere discussion endpoint is unreachable',
        'DISCUTERE_DISCUSSION_UNREACHABLE',
        502
      );
    }
    if (!response.ok) {
      throw publicationError(
        'Discutere rejected the discussion request',
        'DISCUTERE_DISCUSSION_REJECTED',
        response.status === 503 ? 503 : 502
      );
    }
    try {
      return await response.json();
    } catch {
      throw publicationError(
        'Discutere returned invalid JSON',
        'DISCUTERE_DISCUSSION_RESPONSE_INVALID',
        502
      );
    }
  }
}

module.exports = {
  DiscutereDiscussionPublisher,
  discuterePersonaId,
};
