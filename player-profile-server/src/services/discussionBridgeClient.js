const DISCORD_SNOWFLAKE_PATTERN = /^[0-9]{5,24}$/;
const MAX_UTTERANCES = 1_000;
const MAX_UTTERANCE_TEXT_LENGTH = 8_000;
const MAX_PAGES = 100;
const MAX_CURSOR_LENGTH = 512;
const PERSONA_ASSERTION_HEADER = 'x-discutere-persona-assertion';

const { DiscussionBridgeAssertionSigner } = require('./discussionBridgeAssertion');

/** @implements SPEC-DISCUSSION-RETURN-ASSERTION */
function bridgeError(message, code, statusCode) {
  return Object.assign(new Error(message), { code, statusCode });
}

/** @implements SPEC-DISCUSSION-RETURN-ASSERTION */
function normalizeBridgeBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw bridgeError(
      'Discutere persona bridge URL is invalid',
      'DISCUTERE_BRIDGE_CONFIG_INVALID',
      503
    );
  }
  const loopback = url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw bridgeError(
      'Discutere persona bridge URL must use HTTPS or numeric loopback HTTP',
      'DISCUTERE_BRIDGE_CONFIG_INVALID',
      503
    );
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
  return url;
}

/** @implements SPEC-DISCUSSION-RETURN-PAGINATION */
function validateUtterance(value, index) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw bridgeError(
      `Discutere returned an invalid utterance at index ${index}`,
      'DISCUTERE_BRIDGE_RESPONSE_INVALID',
      502
    );
  }
  const createdAt = typeof value.createdAt === 'string'
    ? new Date(value.createdAt)
    : null;
  if (
    typeof value.text !== 'string'
    || value.text.trim().length < 1
    || value.text.length > MAX_UTTERANCE_TEXT_LENGTH
    || !createdAt
    || !Number.isFinite(createdAt.getTime())
  ) {
    throw bridgeError(
      `Discutere returned an invalid utterance at index ${index}`,
      'DISCUTERE_BRIDGE_RESPONSE_INVALID',
      502
    );
  }
  return {
    text: value.text,
    createdAt: createdAt.toISOString(),
  };
}

/** @implements SPEC-DISCUSSION-RETURN-PAGINATION */
function validateBridgeResponse(value) {
  if (
    !value
    || typeof value !== 'object'
    || value.ok !== true
    || !Array.isArray(value.utterances)
    || value.utterances.length > MAX_UTTERANCES
    || !Object.hasOwn(value, 'nextCursor')
    || (
      value.nextCursor !== null
      && (
        typeof value.nextCursor !== 'string'
        || value.nextCursor.length < 1
        || value.nextCursor.length > MAX_CURSOR_LENGTH
      )
    )
  ) {
    throw bridgeError(
      'Discutere returned an invalid persona bridge response',
      'DISCUTERE_BRIDGE_RESPONSE_INVALID',
      502
    );
  }
  return {
    utterances: value.utterances.map(validateUtterance),
    nextCursor: value.nextCursor,
  };
}

class DiscussionBridgeClient {
  /** @implements SPEC-DISCUSSION-RETURN-ASSERTION */
  constructor({
    baseUrl,
    token,
    assertionPrivateKey,
    assertionSigner,
    fetchImpl = fetch,
    timeoutMs = 10_000,
  }) {
    if (assertionPrivateKey && token === assertionPrivateKey) {
      throw bridgeError(
        'Discutere persona bridge bearer token and assertion private key must differ',
        'DISCUTERE_BRIDGE_CONFIG_INVALID',
        503
      );
    }
    if (assertionSigner && typeof assertionSigner.signForAuthor !== 'function') {
      throw bridgeError(
        'Discutere persona bridge assertion signer is invalid',
        'DISCUTERE_BRIDGE_CONFIG_INVALID',
        503
      );
    }
    this.baseUrl = baseUrl;
    this.token = token;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.assertionSigner = assertionSigner
      || (assertionPrivateKey
        ? new DiscussionBridgeAssertionSigner({ privateKey: assertionPrivateKey })
        : null);
  }

  /** @implements SPEC-DISCUSSION-RETURN-PAGINATION */
  async listUtterances({ authorId, since = 0 }) {
    if (!this.baseUrl || !this.token || !this.assertionSigner) {
      throw bridgeError(
        'Discutere persona bridge is not configured',
        'DISCUTERE_BRIDGE_UNAVAILABLE',
        503
      );
    }
    if (typeof authorId !== 'string' || !DISCORD_SNOWFLAKE_PATTERN.test(authorId)) {
      throw bridgeError('Linked Discord identity is invalid', 'DISCORD_IDENTITY_INVALID', 409);
    }
    if (!Number.isInteger(since) || since < 0) {
      throw new TypeError('since must be a non-negative epoch millisecond');
    }

    const baseUrl = normalizeBridgeBaseUrl(this.baseUrl);
    const utterances = [];
    const seenCursors = new Set();
    let cursor = null;
    for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
      const url = new URL('api/persona-bridge/utterances', baseUrl);
      url.searchParams.set('authorId', authorId);
      if (cursor) url.searchParams.set('cursor', cursor);
      else url.searchParams.set('since', String(since));
      url.searchParams.set('limit', String(MAX_UTTERANCES));
      const assertion = this.assertionSigner.signForAuthor(authorId);
      let response;
      try {
        response = await this.fetchImpl(url, {
          headers: {
            Authorization: `Bearer ${this.token}`,
            [PERSONA_ASSERTION_HEADER]: assertion,
          },
          redirect: 'error',
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch {
        throw bridgeError(
          'Discutere persona bridge is unreachable',
          'DISCUTERE_BRIDGE_UNREACHABLE',
          502
        );
      }
      if (!response.ok) {
        throw bridgeError(
          'Discutere persona bridge rejected the request',
          'DISCUTERE_BRIDGE_REJECTED',
          response.status === 503 ? 503 : 502
        );
      }
      let payload;
      try {
        payload = await response.json();
      } catch {
        throw bridgeError(
          'Discutere returned invalid JSON',
          'DISCUTERE_BRIDGE_RESPONSE_INVALID',
          502
        );
      }
      const page = validateBridgeResponse(payload);
      utterances.push(...page.utterances);
      if (!page.nextCursor) return utterances;
      if (seenCursors.has(page.nextCursor)) {
        throw bridgeError(
          'Discutere returned a repeated persona bridge cursor',
          'DISCUTERE_BRIDGE_RESPONSE_INVALID',
          502
        );
      }
      seenCursors.add(page.nextCursor);
      cursor = page.nextCursor;
    }
    throw bridgeError(
      'Discutere persona bridge exceeded the page limit',
      'DISCUTERE_BRIDGE_RESPONSE_INVALID',
      502
    );
  }
}

module.exports = {
  DISCORD_SNOWFLAKE_PATTERN,
  DiscussionBridgeClient,
  MAX_UTTERANCES,
  MAX_PAGES,
  PERSONA_ASSERTION_HEADER,
  normalizeBridgeBaseUrl,
  validateBridgeResponse,
};
