const test = require('node:test');
const assert = require('node:assert/strict');

const {
  HASTER_PUBLIC_TEST_TOKEN,
  HASTER_PUBLIC_TEST_USER_ID,
  authenticateHasterPublicToken,
} = require('./publicTestIdentity');

test('public token authenticates only when HASTER is enabled', () => {
  const header = `Bearer ${HASTER_PUBLIC_TEST_TOKEN}`;
  assert.equal(authenticateHasterPublicToken(header, false), null);
  assert.equal(authenticateHasterPublicToken('Bearer wrong', true), null);
  assert.equal(authenticateHasterPublicToken(header, true)?.id, HASTER_PUBLIC_TEST_USER_ID);
});
