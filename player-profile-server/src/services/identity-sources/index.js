const config = require('../../config');
const { createOidcSource } = require('./oidc-source');

const registry = new Map(
  ['cernere', 'google', 'discord'].map((key) => [key, createOidcSource(key, config.oauth[key])])
);

function getIdentitySource(key) {
  if (!config.auth.sources.includes(key)) return null;
  return registry.get(key) || null;
}

function listIdentitySources() {
  return config.auth.sources
    .map((key) => registry.get(key))
    .filter(Boolean);
}

module.exports = { getIdentitySource, listIdentitySources };
