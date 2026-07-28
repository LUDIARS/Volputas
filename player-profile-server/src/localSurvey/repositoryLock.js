'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createProcessRunner } = require('./processRunner');

const LOCK_FILE_NAME = 'voluptas-survey.lock';

class RepositoryLockError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RepositoryLockError';
    this.code = code;
  }
}

function createRepositoryLock({
  repositoryRoot,
  runner = createProcessRunner(),
  gitCommand = 'git',
  fileSystem = fs,
} = {}) {
  validateConfiguration(repositoryRoot, runner, gitCommand, fileSystem);
  const normalizedRoot = path.resolve(repositoryRoot);

  return Object.freeze({
    runExclusive(operation) {
      if (typeof operation !== 'function') {
        throw new TypeError('lock operation must be a function');
      }

      const lockPath = resolveLockPath(normalizedRoot, runner, gitCommand);
      const descriptor = acquireLock(lockPath, fileSystem);
      const release = createRelease(lockPath, descriptor, fileSystem);

      let result;
      try {
        result = operation(Object.freeze({ lockPath }));
      } catch (error) {
        release();
        throw error;
      }

      let resultIsPromiseLike;
      try {
        resultIsPromiseLike = isPromiseLike(result);
      } catch (error) {
        release();
        throw error;
      }

      if (resultIsPromiseLike) {
        return Promise.resolve(result).then(
          (value) => {
            release();
            return value;
          },
          (error) => {
            release();
            throw error;
          }
        );
      }

      release();
      return result;
    },
  });
}

function resolveLockPath(repositoryRoot, runner, gitCommand) {
  let result;
  try {
    result = runner.run(
      gitCommand,
      ['rev-parse', '--git-path', LOCK_FILE_NAME],
      { cwd: repositoryRoot }
    );
  } catch {
    throw new RepositoryLockError(
      'LOCK_PATH_UNAVAILABLE',
      'Unable to resolve the survey repository lock path.'
    );
  }

  const reportedPath = readSingleLine(result.stdout);
  if (!reportedPath) {
    throw new RepositoryLockError(
      'LOCK_PATH_UNAVAILABLE',
      'Unable to resolve the survey repository lock path.'
    );
  }

  const lockPath = path.resolve(repositoryRoot, reportedPath);
  if (path.basename(lockPath) !== LOCK_FILE_NAME) {
    throw new RepositoryLockError(
      'LOCK_PATH_INVALID',
      'Git returned an invalid survey repository lock path.'
    );
  }
  return lockPath;
}

function acquireLock(lockPath, fileSystem) {
  try {
    return fileSystem.openSync(lockPath, 'wx', 0o600);
  } catch (error) {
    if (error && error.code === 'EEXIST') {
      throw new RepositoryLockError(
        'LOCK_HELD',
        'Another local survey operation is already using this repository.'
      );
    }
    throw new RepositoryLockError(
      'LOCK_ACQUIRE_FAILED',
      'Unable to acquire the survey repository lock.'
    );
  }
}

function createRelease(lockPath, descriptor, fileSystem) {
  let isReleased = false;
  return function release() {
    if (isReleased) {
      return;
    }
    isReleased = true;

    let didFail = false;
    try {
      fileSystem.closeSync(descriptor);
    } catch {
      didFail = true;
    }
    try {
      fileSystem.unlinkSync(lockPath);
    } catch (error) {
      if (!error || error.code !== 'ENOENT') {
        didFail = true;
      }
    }

    if (didFail) {
      throw new RepositoryLockError(
        'LOCK_RELEASE_FAILED',
        'The survey repository lock could not be released safely.'
      );
    }
  };
}

function validateConfiguration(repositoryRoot, runner, gitCommand, fileSystem) {
  if (
    typeof repositoryRoot !== 'string'
    || repositoryRoot.length === 0
    || !path.isAbsolute(repositoryRoot)
  ) {
    throw new TypeError('repositoryRoot must be an absolute path');
  }
  if (!runner || typeof runner.run !== 'function') {
    throw new TypeError('runner must expose a run function');
  }
  if (
    typeof gitCommand !== 'string'
    || gitCommand.length === 0
    || /[\0\r\n]/.test(gitCommand)
  ) {
    throw new TypeError('gitCommand must be a non-empty executable');
  }
  for (const method of ['openSync', 'closeSync', 'unlinkSync']) {
    if (!fileSystem || typeof fileSystem[method] !== 'function') {
      throw new TypeError(`fileSystem must expose ${method}`);
    }
  }
}

function readSingleLine(output) {
  if (typeof output !== 'string' || output.includes('\0')) {
    return null;
  }
  const lines = output.trim().split(/\r?\n/);
  return lines.length === 1 && lines[0].length > 0 ? lines[0] : null;
}

function isPromiseLike(value) {
  return (
    value !== null
    && (typeof value === 'object' || typeof value === 'function')
    && typeof value.then === 'function'
  );
}

module.exports = {
  LOCK_FILE_NAME,
  RepositoryLockError,
  createRepositoryLock,
};
