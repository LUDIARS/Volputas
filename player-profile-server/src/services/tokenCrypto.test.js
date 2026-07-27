const test = require('node:test');
const assert = require('node:assert/strict');

process.env.MEMORIA_LINK_ENCRYPTION_KEY = 'test-only-secret-do-not-use-in-prod';
delete require.cache[require.resolve('../config')];
const { encrypt, decrypt } = require('./tokenCrypto');

test('encrypt/decrypt round-trips the plaintext', () => {
  const plaintext = 'a-very-secret-memoria-token';
  const ciphertext = encrypt(plaintext);
  assert.notEqual(ciphertext, plaintext);
  assert.equal(decrypt(ciphertext), plaintext);
});

test('encrypting the same plaintext twice produces different ciphertext (random IV)', () => {
  const a = encrypt('same-input');
  const b = encrypt('same-input');
  assert.notEqual(a, b);
  assert.equal(decrypt(a), 'same-input');
  assert.equal(decrypt(b), 'same-input');
});

test('decrypt rejects tampered ciphertext', () => {
  const ciphertext = encrypt('tamper-me');
  const buf = Buffer.from(ciphertext, 'base64');
  buf[buf.length - 1] ^= 0xff;
  assert.throws(() => decrypt(buf.toString('base64')));
});
