const test = require('node:test');
const assert = require('node:assert/strict');
const { pickProfileFields } = require('./profileFields');

test('raw identity profile uses a strict allowlist', () => {
  assert.deepEqual(pickProfileFields('google', {
    sub: 'subject',
    name: 'Player',
    email: 'player@example.test',
    hd: 'example.test',
    given_name: 'Secret extra',
  }), {
    sub: 'subject',
    name: 'Player',
    email: 'player@example.test',
  });
});
