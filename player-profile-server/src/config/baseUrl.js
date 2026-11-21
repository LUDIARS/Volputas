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
  if (parsed.protocol === 'http:' && !isPlaintextAllowedHostname(parsed.hostname)) {
    throw new Error(
      `${name} must use HTTPS unless the host is loopback or a Tailscale IPv4 address (100.64.0.0/10); ` +
        'use an https:// URL, or point it at localhost / the Tailscale IP literal instead of a hostname',
    );
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${name} must not contain credentials, query, or fragment`);
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.toString().replace(/\/$/, '');
}

// Plaintext HTTP is accepted only where the transport is already protected:
// loopback, or a Tailscale address (CGNAT 100.64.0.0/10, WireGuard-encrypted).
// Hostnames such as *.ts.net and other private ranges stay HTTPS-only.
function isPlaintextAllowedHostname(hostname) {
  return isLoopbackHostname(hostname) || isTailnetIpv4(hostname);
}

function isTailnetIpv4(hostname) {
  const octets = parseIpv4(hostname);
  if (!octets) return false;
  return octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127;
}

function parseIpv4(hostname) {
  if (!/^[0-9]{1,3}(?:\.[0-9]{1,3}){3}$/.test(hostname)) return null;
  const octets = hostname.split('.').map(Number);
  return octets.every((part) => part >= 0 && part <= 255) ? octets : null;
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
