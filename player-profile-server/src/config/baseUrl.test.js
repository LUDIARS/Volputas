const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeOptionalBaseUrl } = require('./baseUrl');

test('normalizes optional Corpus integration base URLs', () => {
  assert.equal(normalizeOptionalBaseUrl(undefined, 'TEST_URL'), '');
  assert.equal(normalizeOptionalBaseUrl('  ', 'TEST_URL'), '');
  assert.equal(
    normalizeOptionalBaseUrl('https://example.test/base///', 'TEST_URL'),
    'https://example.test/base',
  );
});

test('rejects unsafe or ambiguous Corpus integration URLs', () => {
  for (const value of [
    'not-a-url',
    'file:///tmp/service',
    'https://user:secret@example.test',
    'https://example.test/?next=other',
    'https://example.test/#fragment',
  ]) {
    assert.throws(
      () => normalizeOptionalBaseUrl(value, 'TEST_URL'),
      /TEST_URL/,
    );
  }
});

test('allows plaintext HTTP only for explicit loopback hosts', () => {
  for (const value of [
    'http://localhost:11111/base/',
    'http://127.0.0.1:11111',
    'http://127.42.7.9/service',
    'http://[::1]:11111',
  ]) {
    assert.match(normalizeOptionalBaseUrl(value, 'TEST_URL'), /^http:/);
  }
});

test('rejects plaintext HTTP for every non-loopback host', () => {
  for (const value of [
    'http://example.test',
    'http://localhost.example.test',
    'http://10.0.0.1',
    'http://192.168.1.10',
    'http://[::ffff:127.0.0.1]',
  ]) {
    assert.throws(
      () => normalizeOptionalBaseUrl(value, 'TEST_URL'),
      /TEST_URL must use HTTPS unless the host is loopback/,
    );
  }
});
