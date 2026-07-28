function normalizeOptionalBaseUrl(value, name) {
  const candidate = value?.trim();
  if (!candidate) return '';

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`${name} must be an absolute HTTP(S) URL`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`${name} must use HTTP or HTTPS`);
  }
  if (parsed.protocol === 'http:' && !isLoopbackHostname(parsed.hostname)) {
    throw new Error(`${name} must use HTTPS unless the host is loopback`);
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${name} must not contain credentials, query, or fragment`);
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.toString().replace(/\/$/, '');
}

function isLoopbackHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized === 'localhost' || normalized === '::1') return true;
  if (!/^127(?:\.[0-9]{1,3}){3}$/.test(normalized)) return false;
  return normalized
    .split('.')
    .every((part) => Number(part) >= 0 && Number(part) <= 255);
}

module.exports = { normalizeOptionalBaseUrl };
