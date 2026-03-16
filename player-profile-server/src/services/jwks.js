const crypto = require('crypto');
const jose = require('node-jose');

let keyStore = null;
let currentKid = null;

async function initKeyStore() {
  if (keyStore) return;

  keyStore = jose.JWK.createKeyStore();

  const key = await keyStore.generate('RSA', 2048, {
    alg: 'RS256',
    use: 'sig',
    kid: generateKid(),
  });

  currentKid = key.kid;
}

function generateKid() {
  return crypto.randomBytes(8).toString('hex');
}

async function getJWKS() {
  await initKeyStore();
  return keyStore.toJSON();
}

async function getSigningKey(kid) {
  await initKeyStore();

  const key = keyStore.get(kid || currentKid);
  if (!key) {
    throw new Error('Signing key not found');
  }

  return {
    privateKey: key.toPEM(true),
    publicKey: key.toPEM(false),
    kid: key.kid,
  };
}

async function getCurrentSigningKey() {
  await initKeyStore();
  return getSigningKey(currentKid);
}

module.exports = { initKeyStore, getJWKS, getSigningKey, getCurrentSigningKey };
