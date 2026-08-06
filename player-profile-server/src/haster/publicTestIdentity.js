const crypto = require('node:crypto');

const HASTER_PUBLIC_TEST_USER_ID = '00000000-0000-4000-8000-000000000657';
const HASTER_PUBLIC_TEST_DISCORD_ID = '1000000000000000657';
// Cernere managed-project rows reference users(id), so this subject must be a
// real UUID in Cernere. Reusing the public HASTER user ID keeps the fixture
// deterministic and makes it safe to publish alongside the test token.
const HASTER_PUBLIC_TEST_CERNERE_SUB = HASTER_PUBLIC_TEST_USER_ID;
const HASTER_PUBLIC_TEST_TOKEN = 'haster-public-test-token-v1';

// @implements SPEC-HASTER-PUBLIC-IDENTITY
function bearerToken(header) {
  return typeof header === 'string' ? /^Bearer ([^\s]+)$/.exec(header)?.[1] || '' : '';
}

// @implements SPEC-HASTER-PUBLIC-IDENTITY
function tokenMatches(actual, expected) {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

// @implements SPEC-HASTER-PUBLIC-IDENTITY
function authenticateHasterPublicToken(header, enabled) {
  if (!enabled || !tokenMatches(bearerToken(header), HASTER_PUBLIC_TEST_TOKEN)) return null;
  return {
    id: HASTER_PUBLIC_TEST_USER_ID,
    jti: 'haster-public-test-token-v1',
    issuedAt: Math.floor(Date.now() / 1000),
  };
}

module.exports = {
  HASTER_PUBLIC_TEST_CERNERE_SUB,
  HASTER_PUBLIC_TEST_DISCORD_ID,
  HASTER_PUBLIC_TEST_TOKEN,
  HASTER_PUBLIC_TEST_USER_ID,
  authenticateHasterPublicToken,
};
