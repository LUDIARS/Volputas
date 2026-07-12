const test = require('node:test');
const assert = require('node:assert/strict');
const { MemoryOneTimeStore } = require('./oneTimeStore');

test('one-time values are consumed once', async () => {
  const store = new MemoryOneTimeStore();
  assert.equal(await store.put('oauth_state', 'abc', { provider: 'google' }, 600), true);
  assert.deepEqual(await store.consume('oauth_state', 'abc'), { provider: 'google' });
  assert.equal(await store.consume('oauth_state', 'abc'), null);
});

test('expired one-time values are rejected', async () => {
  let now = 1_000;
  const store = new MemoryOneTimeStore({ now: () => now });
  await store.put('oauth_state', 'expired', { provider: 'google' }, 10);
  now += 10_001;
  assert.equal(await store.consume('oauth_state', 'expired'), null);
});
