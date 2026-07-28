const crypto = require('crypto');

const keyStore = new Map();
let currentKid = null;

async function initKeyStore() {
  if (currentKid) return;

  const { generateKeyPair } = await import('jose');
  const kid = generateKid();
  const { privateKey, publicKey } = await generateKeyPair('RS256', {
    extractable: true,
    modulusLength: 2048,
  });

  keyStore.set(kid, { privateKey, publicKey });
  currentKid = kid;
}

function generateKid() {
  return crypto.randomBytes(8).toString('hex');
}

async function getJWKS() {
  await initKeyStore();
  const { exportJWK } = await import('jose');
  const keys = await Promise.all(Array.from(keyStore, async ([kid, key]) => ({
    ...await exportJWK(key.publicKey),
    alg: 'RS256',
    kid,
    use: 'sig',
  })));
  return { keys };
}

async function getSigningKey(kid) {
  await initKeyStore();

  const resolvedKid = kid || currentKid;
  const key = keyStore.get(resolvedKid);
  if (!key) {
    throw new Error('Signing key not found');
  }

  const { exportPKCS8, exportSPKI } = await import('jose');
  return {
    privateKey: await exportPKCS8(key.privateKey),
    publicKey: await exportSPKI(key.publicKey),
    kid: resolvedKid,
  };
}

async function getCurrentSigningKey() {
  await initKeyStore();
  return getSigningKey(currentKid);
}

module.exports = { initKeyStore, getJWKS, getSigningKey, getCurrentSigningKey };
