const test = require('node:test');
const assert = require('node:assert/strict');
const router = require('./users');

test('users API has no client-asserted federated identity creation route', () => {
  const unsafeRoute = router.stack.find((layer) =>
    layer.route?.path === '/me/identities'
    && layer.route.methods.post);
  assert.equal(unsafeRoute, undefined);
});
