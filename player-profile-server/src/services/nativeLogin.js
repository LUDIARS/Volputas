const crypto = require('node:crypto');
const { AppError } = require('../middleware/errorHandler');

function invalid(message) {
  throw new AppError(400, 'INVALID_NATIVE_LOGIN', message);
}

function parseNativeLogin(query) {
  if (query.client === undefined) return null;
  if (query.client !== 'spectator') invalid('Unsupported native client');
  if (query.code_challenge_method !== 'S256') invalid('code_challenge_method must be S256');
  if (typeof query.code_challenge !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(query.code_challenge)) {
    invalid('A valid PKCE code_challenge is required');
  }
  if (typeof query.nonce !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(query.nonce)) {
    invalid('A valid nonce is required');
  }

  let redirect;
  try {
    redirect = new URL(query.redirect_uri);
  } catch {
    invalid('redirect_uri must be an absolute URL');
  }
  if (redirect.protocol !== 'http:'
      || redirect.hostname !== '127.0.0.1'
      || !redirect.port
      || redirect.pathname !== '/callback'
      || redirect.username
      || redirect.password
      || redirect.search
      || redirect.hash) {
    invalid('redirect_uri must be http://127.0.0.1:<port>/callback');
  }
  const port = Number.parseInt(redirect.port, 10);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) invalid('redirect_uri uses an invalid port');

  return {
    client: 'spectator',
    redirectUri: redirect.toString(),
    codeChallenge: query.code_challenge,
    nonce: query.nonce,
  };
}

function verifyCodeVerifier(verifier, expectedChallenge) {
  if (typeof verifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const actual = crypto.createHash('sha256').update(verifier).digest('base64url');
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expectedChallenge);
  return actualBytes.length === expectedBytes.length && crypto.timingSafeEqual(actualBytes, expectedBytes);
}

module.exports = { parseNativeLogin, verifyCodeVerifier };
