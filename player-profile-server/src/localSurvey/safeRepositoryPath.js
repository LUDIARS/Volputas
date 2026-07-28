'use strict';

const fs = require('node:fs');
const path = require('node:path');

class UnsafeRepositoryPathError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'UnsafeRepositoryPathError';
    this.code = code;
  }
}

function ensureSafeRepositoryDirectory(
  repositoryRoot,
  directory,
  {
    lstat = fs.lstatSync,
    mkdir = fs.mkdirSync,
    realpath = fs.realpathSync.native,
  } = {}
) {
  const root = requireAbsolutePath(repositoryRoot, 'repositoryRoot');
  const target = requireAbsolutePath(directory, 'directory');
  const relative = path.relative(root, target);
  if (
    relative === '..'
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
  ) {
    throw new UnsafeRepositoryPathError(
      'PATH_OUTSIDE_REPOSITORY',
      'A survey artifact directory is outside the configured data repository.'
    );
  }

  const rootRealPath = inspectCanonicalDirectory(root, root, lstat, realpath);
  inspectExistingPrefix(root, rootRealPath, relative, lstat, realpath);

  try {
    mkdir(target, { recursive: true, mode: 0o700 });
  } catch {
    throw new UnsafeRepositoryPathError(
      'DIRECTORY_CREATE_FAILED',
      'A survey artifact directory could not be created safely.'
    );
  }

  inspectCompletePath(root, rootRealPath, relative, lstat, realpath);
  return target;
}

function inspectExistingPrefix(root, rootRealPath, relative, lstat, realpath) {
  let current = root;
  const segments = splitRelativePath(relative);
  for (let index = 0; index <= segments.length; index += 1) {
    if (!pathExists(current, lstat)) {
      return;
    }
    const expected = path.join(rootRealPath, ...segments.slice(0, index));
    inspectCanonicalDirectory(current, expected, lstat, realpath);
    if (index < segments.length) {
      current = path.join(current, segments[index]);
    }
  }
}

function inspectCompletePath(root, rootRealPath, relative, lstat, realpath) {
  let current = root;
  const segments = splitRelativePath(relative);
  for (let index = 0; index <= segments.length; index += 1) {
    const expected = path.join(rootRealPath, ...segments.slice(0, index));
    inspectCanonicalDirectory(current, expected, lstat, realpath);
    if (index < segments.length) {
      current = path.join(current, segments[index]);
    }
  }
}

function inspectCanonicalDirectory(candidate, expected, lstat, realpath) {
  let metadata;
  let canonical;
  try {
    metadata = lstat(candidate);
    canonical = realpath(candidate);
  } catch {
    throw new UnsafeRepositoryPathError(
      'DIRECTORY_INSPECTION_FAILED',
      'A survey artifact directory could not be verified safely.'
    );
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new UnsafeRepositoryPathError(
      'UNSAFE_DIRECTORY_TYPE',
      'A survey artifact directory is not a regular directory.'
    );
  }
  if (normalizeComparablePath(canonical) !== normalizeComparablePath(expected)) {
    throw new UnsafeRepositoryPathError(
      'DIRECTORY_LINK_DETECTED',
      'A survey artifact directory resolves through a link or junction.'
    );
  }
  return canonical;
}

function pathExists(candidate, lstat) {
  try {
    lstat(candidate);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return false;
    }
    throw new UnsafeRepositoryPathError(
      'DIRECTORY_INSPECTION_FAILED',
      'A survey artifact directory could not be verified safely.'
    );
  }
}

function splitRelativePath(relative) {
  return relative === '' ? [] : relative.split(path.sep);
}

function requireAbsolutePath(candidate, label) {
  if (
    typeof candidate !== 'string'
    || candidate.length === 0
    || !path.isAbsolute(candidate)
  ) {
    throw new TypeError(`${label} must be an absolute path`);
  }
  return path.resolve(candidate);
}

function normalizeComparablePath(candidate) {
  const normalized = path.resolve(candidate);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

module.exports = {
  UnsafeRepositoryPathError,
  ensureSafeRepositoryDirectory,
};
