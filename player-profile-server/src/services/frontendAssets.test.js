const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  assertFrontendBuild,
  frontendIndexPath,
  isBackendPath,
} = require('./frontendAssets');

test('frontend asset routing leaves backend endpoints to the API handlers', () => {
  assert.equal(isBackendPath('/api/runtime'), true);
  assert.equal(isBackendPath('/auth/callback'), true);
  assert.equal(isBackendPath('/health'), true);
  assert.equal(isBackendPath('/persona'), false);
});

test('frontend build assertion fails closed when index.html is absent', () => {
  const missing = path.join(__dirname, 'missing-frontend-build');
  assert.equal(frontendIndexPath(missing), path.join(missing, 'index.html'));
  assert.throws(
    () => assertFrontendBuild(missing),
    (error) => error.code === 'FRONTEND_BUILD_MISSING'
  );
});
