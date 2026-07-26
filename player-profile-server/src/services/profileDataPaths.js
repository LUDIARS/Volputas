const path = require('node:path');

const SAFE_SEGMENT = /^[\p{L}\p{N}._-]+$/u;

function assertSafeSegment(value, label) {
  if (typeof value !== 'string' || !SAFE_SEGMENT.test(value) || value === '.' || value === '..') {
    throw Object.assign(new Error(`${label} contains characters that cannot be used in a data path`), {
      code: 'INVALID_PROFILE_PATH',
    });
  }
  return value;
}

function insideRepository(repositoryRoot, ...segments) {
  const root = path.resolve(repositoryRoot);
  const target = path.resolve(root, ...segments);
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw Object.assign(new Error('Profile data path escapes the data repository'), {
      code: 'INVALID_PROFILE_PATH',
    });
  }
  return target;
}

function collectionDirectory(repositoryRoot, collection, name) {
  return insideRepository(
    repositoryRoot,
    assertSafeSegment(collection, 'Collection'),
    assertSafeSegment(name, 'Name')
  );
}

function recordPath(repositoryRoot, collection, name, recordId) {
  return insideRepository(
    collectionDirectory(repositoryRoot, collection, name),
    `${assertSafeSegment(recordId, 'Record ID')}.json`
  );
}

module.exports = {
  assertSafeSegment,
  collectionDirectory,
  insideRepository,
  recordPath,
};
