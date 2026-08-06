const test = require('node:test');
const assert = require('node:assert/strict');

const {
  HASTER_PUBLIC_TEST_PERSONA_EXPORT_TOKEN,
  HASTER_PUBLIC_TEST_PSEUDO_ID_SECRET,
  HASTER_PUBLIC_TEST_TOKEN,
  HASTER_PUBLIC_TEST_USER_ID,
  authenticateHasterPublicToken,
  hasterPublicFixtureValue,
} = require('./publicTestIdentity');

test('public token authenticates only when HASTER is enabled', () => {
  const header = `Bearer ${HASTER_PUBLIC_TEST_TOKEN}`;
  assert.equal(authenticateHasterPublicToken(header, false), null);
  assert.equal(authenticateHasterPublicToken('Bearer wrong', true), null);
  assert.equal(authenticateHasterPublicToken(header, true)?.id, HASTER_PUBLIC_TEST_USER_ID);
});

test('public bridge fixtures are fallback values only inside HASTER', () => {
  assert.equal(hasterPublicFixtureValue('', false, HASTER_PUBLIC_TEST_PERSONA_EXPORT_TOKEN), '');
  assert.equal(
    hasterPublicFixtureValue('', true, HASTER_PUBLIC_TEST_PERSONA_EXPORT_TOKEN),
    HASTER_PUBLIC_TEST_PERSONA_EXPORT_TOKEN
  );
  assert.equal(
    hasterPublicFixtureValue(undefined, true, HASTER_PUBLIC_TEST_PSEUDO_ID_SECRET),
    HASTER_PUBLIC_TEST_PSEUDO_ID_SECRET
  );
  assert.equal(
    hasterPublicFixtureValue('configured-value', true, HASTER_PUBLIC_TEST_PSEUDO_ID_SECRET),
    'configured-value'
  );
});
