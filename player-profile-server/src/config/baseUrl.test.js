const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeOptionalBaseUrl } = require('./baseUrl');

// Tailscale の範囲 (CGNAT) にある例示用のアドレス。実在の拠点のアドレスではない
// (公開リポに拠点のアドレスを書かないため、番号は組み立てて使う)。
const TAILNET_EXAMPLE = ['100', '100', '10', '20'].join('.');

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
    'http://100.63.255.255',
    'http://100.128.0.0',
    'http://host.tailnet-example.ts.net',
    `http://[::ffff:${TAILNET_EXAMPLE}]`,
  ]) {
    assert.throws(
      () => normalizeOptionalBaseUrl(value, 'TEST_URL'),
      /TEST_URL must use HTTPS unless the host is loopback/,
    );
  }
});

test('allows plaintext HTTP for Tailscale IPv4 literals (100.64.0.0/10)', () => {
  for (const value of [
    'http://100.64.0.0',
    `http://${TAILNET_EXAMPLE}:8086`,
    'http://100.127.255.255/base/',
  ]) {
    assert.match(normalizeOptionalBaseUrl(value, 'TEST_URL'), /^http:\/\/100\./);
  }
  assert.equal(
    normalizeOptionalBaseUrl(`http://${TAILNET_EXAMPLE}:8086/`, 'CERNERE_BASE_URL'),
    `http://${TAILNET_EXAMPLE}:8086`,
  );
});

test('keeps rejecting credentials, query, and fragment on Tailscale hosts', () => {
  for (const value of [
    `http://user:secret@${TAILNET_EXAMPLE}`,
    `http://${TAILNET_EXAMPLE}/?next=other`,
    `http://${TAILNET_EXAMPLE}/#fragment`,
  ]) {
    assert.throws(
      () => normalizeOptionalBaseUrl(value, 'TEST_URL'),
      /TEST_URL must not contain credentials, query, or fragment/,
    );
  }
});
