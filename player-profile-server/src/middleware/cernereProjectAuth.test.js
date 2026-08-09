const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CernereIntegrationError,
  InvalidCernereTokenError,
} = require('../integrations/cernere/cernereErrors');
const {
  bearerToken,
  createCernereProjectAuth,
} = require('./cernereProjectAuth');

function responseRecorder() {
  return {
    statusCode: 0,
    body: null,
    status(value) {
      this.statusCode = value;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
  };
}

test('accepts a verified Cernere subject without Voluptas login', async () => {
  const middleware = createCernereProjectAuth({
    verifier: {
      verify: async () => ({ sub: '66e242b5-2f18-4463-b7f0-c0f12d818a20' }),
    },
  });
  const req = { headers: { authorization: 'Bearer test-token' } };
  const res = responseRecorder();
  let called = false;
  await middleware(req, res, () => { called = true; });

  assert.equal(called, true);
  assert.deepEqual(req.cernereUser, {
    id: '66e242b5-2f18-4463-b7f0-c0f12d818a20',
    // role / displayName は任意クレーム。 載っていないトークンでも管理者に
    // 昇格しないことを、 明示的な null で固定する。
    role: null,
    displayName: null,
  });
});

test('carries the role claim so admin routes can authorise', async () => {
  const middleware = createCernereProjectAuth({
    verifier: {
      verify: async () => ({
        sub: '66e242b5-2f18-4463-b7f0-c0f12d818a20',
        role: 'admin',
        displayName: 'Teacher',
      }),
    },
  });
  const req = { headers: { authorization: 'Bearer test-token' } };
  await middleware(req, responseRecorder(), () => {});

  assert.equal(req.cernereUser.role, 'admin');
  assert.equal(req.cernereUser.displayName, 'Teacher');
});

test('rejects missing and invalid bearer tokens without echoing them', async () => {
  const invalid = createCernereProjectAuth({
    verifier: {
      verify: async () => {
        throw new InvalidCernereTokenError();
      },
    },
  });

  for (const authorization of [undefined, 'Basic abc', 'Bearer secret-token']) {
    const res = responseRecorder();
    await invalid(
      { headers: { authorization } },
      res,
      () => assert.fail('next must not be called'),
    );
    assert.equal(res.statusCode, 401);
    assert.doesNotMatch(JSON.stringify(res.body), /secret-token/);
  }
});

test('forwards public-key upstream failures to the global error handler', async () => {
  const expected = new CernereIntegrationError('Cernere public key request failed');
  const middleware = createCernereProjectAuth({
    verifier: {
      verify: async () => {
        throw expected;
      },
    },
  });
  let received;
  await middleware(
    { headers: { authorization: 'Bearer test-token' } },
    responseRecorder(),
    (error) => { received = error; },
  );
  assert.equal(received, expected);
});

test('extracts exactly one Bearer token', () => {
  assert.equal(bearerToken('Bearer value'), 'value');
  assert.equal(bearerToken('bearer value'), null);
  assert.equal(bearerToken('Bearer value extra'), null);
});
