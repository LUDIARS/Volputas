const crypto = require('crypto');
const config = require('../config');

// memoria_links.token_ciphertext のための対称暗号化。 Memoriaトークンは公開APIキーの
// Steamと違って本人のプライベートデータへの読み取り権限そのものなので、平文保存の
// steamService.js とは扱いを分ける (OAuth token 相当に準じて暗号化)。

function deriveKey() {
  const secret = config.memoriaLink.encryptionKey;
  if (!secret) throw new Error('MEMORIA_LINK_ENCRYPTION_KEY is not configured');
  return crypto.createHash('sha256').update(secret).digest();
}

function encrypt(plaintext) {
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decrypt(ciphertext) {
  const key = deriveKey();
  const buf = Buffer.from(ciphertext, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
