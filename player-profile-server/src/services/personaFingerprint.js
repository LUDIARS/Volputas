const { createHash } = require('node:crypto');

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

function fingerprintSources(sources) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(sources)))
    .digest('hex');
}

module.exports = { canonicalize, fingerprintSources };
