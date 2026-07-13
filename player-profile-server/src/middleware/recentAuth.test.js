const test = require('node:test');
const assert = require('node:assert/strict');
const { requireRecentAuthentication } = require('./recentAuth');

function invoke(issuedAt) {
  const response = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  let continued = false;
  requireRecentAuthentication({ maxAgeSeconds: 300, nowSeconds: () => 1_000 })(
    { user: { issuedAt } },
    response,
    () => { continued = true; }
  );
  return { response, continued };
}

test('recent authentication rejects missing, stale, and future-issued tokens', () => {
  assert.equal(invoke(800).continued, true);
  assert.equal(invoke(699).response.body.error.code, 'RECENT_AUTH_REQUIRED');
  assert.equal(invoke(undefined).response.statusCode, 401);
  assert.equal(invoke(1_001).response.statusCode, 401);
});
