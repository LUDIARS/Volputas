const test = require('node:test');
const assert = require('node:assert/strict');
const {
  bearerToken,
  createPersonaExportAuth,
  tokensMatch,
} = require('./personaExportAuth');

test('persona export project credential comparison is exact and timing-safe compatible', () => {
  assert.equal(bearerToken('Bearer project-secret'), 'project-secret');
  assert.equal(bearerToken('bearer project-secret'), null);
  assert.equal(tokensMatch('project-secret', 'project-secret'), true);
  assert.equal(tokensMatch('wrong-secret', 'project-secret'), false);
  assert.equal(tokensMatch('short', 'project-secret'), false);
});

test('persona export authentication fails closed when unconfigured', () => {
  const middleware = createPersonaExportAuth({ expectedToken: '' });
  let forwarded;
  middleware({ headers: {} }, {}, (error) => {
    forwarded = error;
  });
  assert.equal(forwarded.code, 'PERSONA_EXPORT_UNAVAILABLE');
  assert.equal(forwarded.statusCode, 503);
});

test('persona export authentication rejects an invalid credential without forwarding it', () => {
  const middleware = createPersonaExportAuth({ expectedToken: 'project-secret' });
  let response;
  middleware(
    { headers: { authorization: 'Bearer must-not-leak' } },
    {
      status(statusCode) {
        response = { statusCode };
        return this;
      },
      json(body) {
        response.body = body;
      },
    },
    () => assert.fail('invalid credentials must not reach the route')
  );
  assert.equal(response.statusCode, 401);
  assert.doesNotMatch(JSON.stringify(response.body), /must-not-leak|project-secret/);
});
