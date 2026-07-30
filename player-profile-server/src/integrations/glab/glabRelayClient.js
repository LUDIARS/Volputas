function requiredUrl(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${name} is required`);
  }

  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new TypeError(`${name} must be an absolute HTTP(S) URL`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new TypeError(`${name} must be an absolute HTTP(S) URL`);
  }
  return parsed.toString().replace(/\/$/, '');
}

function requiredText(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${name} is required`);
  }
  return value.trim();
}

async function responseBody(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

const DEFAULT_TIMEOUT_MS = 10_000;

function createGlabRelayClient({
  baseUrl,
  serviceToken,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  if (typeof baseUrl !== 'string' || !baseUrl.trim()
    || typeof serviceToken !== 'string' || !serviceToken.trim()) return null;

  const glabUrl = requiredUrl(baseUrl, 'baseUrl');
  const token = requiredText(serviceToken, 'serviceToken');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');

  return {
    async relayReview(payload) {
      // The caller awaits this relay inside POST /reviews, so an unresponsive
      // GLAB must fail fast instead of holding the submission open.
      const response = await fetchImpl(`${glabUrl}/api/x/volputas/external/review-relay`, {
        method: 'POST',
        headers: {
          'X-Glab-Service-Token': token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body = await responseBody(response);
      if (response.status === 200 || response.status === 201) return body;
      throw new Error(`GLAB review relay failed with status ${response.status}`);
    },
  };
}

module.exports = { createGlabRelayClient };
