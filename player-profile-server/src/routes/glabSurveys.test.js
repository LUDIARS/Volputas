const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { cernereUserKey } = require('./glabSurveys');

test('keys the protected Corpus limiter by verified Cernere subject', () => {
  assert.equal(
    cernereUserKey({
      ip: '127.0.0.1',
      cernereUser: { id: '66e242b5-2f18-4463-b7f0-c0f12d818a20' },
    }),
    '66e242b5-2f18-4463-b7f0-c0f12d818a20',
  );
});

test('marks protected survey data private and no-store before authentication', () => {
  const source = readFileSync(resolve(__dirname, 'glabSurveys.js'), 'utf8');
  const noStore = source.indexOf("res.set('Cache-Control', 'private, no-store')");
  const transportLimit = source.indexOf('router.use(transportRateLimiter)');
  const auth = source.indexOf('router.use(authMiddleware)');
  const userLimit = source.indexOf('router.use(userRateLimiter)');

  assert.ok(noStore >= 0);
  assert.ok(transportLimit > noStore);
  assert.ok(auth > transportLimit);
  assert.ok(userLimit > auth);
});
