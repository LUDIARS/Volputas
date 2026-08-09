const test = require('node:test');
const assert = require('node:assert/strict');
const { isCernereAdmin, requireCernereAdmin } = require('./cernereAdmin');

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
  };
}

test('only the admin role passes', () => {
  assert.equal(isCernereAdmin({ role: 'admin' }), true);
  assert.equal(isCernereAdmin({ role: 'general' }), false);
  assert.equal(isCernereAdmin({ role: null }), false);
  assert.equal(isCernereAdmin({}), false);
  assert.equal(isCernereAdmin(undefined), false);
});

test('a non-admin is refused without reaching the route', () => {
  const res = responseRecorder();
  let called = false;
  requireCernereAdmin({ cernereUser: { id: 'u1', role: 'general' } }, res, () => { called = true; });

  assert.equal(called, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error.code, 'ADMIN_REQUIRED');
});

test('an unauthenticated request is refused rather than crashing', () => {
  const res = responseRecorder();
  requireCernereAdmin({}, res, () => {
    throw new Error('must not reach the route');
  });

  assert.equal(res.statusCode, 403);
});

test('an admin reaches the route', () => {
  let called = false;
  requireCernereAdmin({ cernereUser: { id: 'u1', role: 'admin' } }, responseRecorder(), () => {
    called = true;
  });

  assert.equal(called, true);
});
