const DISCORD_SNOWFLAKE_PATTERN = /^[0-9]{5,24}$/;
const MAX_UTTERANCES = 1_000;
const MAX_UTTERANCE_ID_LENGTH = 200;
const MAX_UTTERANCE_TEXT_LENGTH = 8_000;

function bridgeError(message, code, statusCode) {
  return Object.assign(new Error(message), { code, statusCode });
}

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
    typeof value.id !== 'string'
    || value.id.length < 1
    || value.id.length > MAX_UTTERANCE_ID_LENGTH
    || typeof value.text !== 'string'
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
    id: value.id,
    text: value.text,
    createdAt: createdAt.toISOString(),
  };
}

function validateBridgeResponse(value) {
  if (
    !value
    || typeof value !== 'object'
    || value.ok !== true
    || !Array.isArray(value.utterances)
    || value.utterances.length > MAX_UTTERANCES
  ) {
    throw bridgeError(
      'Discutere returned an invalid persona bridge response',
      'DISCUTERE_BRIDGE_RESPONSE_INVALID',
      502
    );
  }
  const seen = new Set();
  return value.utterances.map(validateUtterance).filter((utterance) => {
    if (seen.has(utterance.id)) {
      throw bridgeError(
        'Discutere returned duplicate utterance ids',
        'DISCUTERE_BRIDGE_RESPONSE_INVALID',
        502
      );
    }
    seen.add(utterance.id);
    return true;
  });
}

class DiscussionBridgeClient {
  constructor({
    baseUrl,
    token,
    fetchImpl = fetch,
    timeoutMs = 10_000,
  }) {
    this.baseUrl = baseUrl;
    this.token = token;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async listUtterances({ authorId, since = 0 }) {
    if (!this.baseUrl || !this.token) {
      throw bridgeError(
        'Discutere persona bridge is not configured',
        'DISCUTERE_BRIDGE_UNAVAILABLE',
        503
      );
    }
    if (!DISCORD_SNOWFLAKE_PATTERN.test(authorId)) {
      throw bridgeError('Linked Discord identity is invalid', 'DISCORD_IDENTITY_INVALID', 409);
    }
    if (!Number.isInteger(since) || since < 0) {
      throw new TypeError('since must be a non-negative epoch millisecond');
    }

    const url = new URL('api/persona-bridge/utterances', normalizeBridgeBaseUrl(this.baseUrl));
    url.searchParams.set('authorId', authorId);
    url.searchParams.set('since', String(since));
    url.searchParams.set('limit', String(MAX_UTTERANCES));
    let response;
    try {
      response = await this.fetchImpl(url, {
        headers: { Authorization: `Bearer ${this.token}` },
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
    return validateBridgeResponse(payload);
  }
}

module.exports = {
  DISCORD_SNOWFLAKE_PATTERN,
  DiscussionBridgeClient,
  MAX_UTTERANCES,
  normalizeBridgeBaseUrl,
  validateBridgeResponse,
};
