'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  LOCK_FILE_NAME,
  RepositoryLockError,
  createRepositoryLock,
} = require('./repositoryLock');

function createFixture(t, { gitCommand = 'git' } = {}) {
  const repositoryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'voluptas-repository-lock-')
  );
  const gitDirectory = path.join(repositoryRoot, '.git');
  fs.mkdirSync(gitDirectory);
  t.after(() => fs.rmSync(repositoryRoot, { recursive: true, force: true }));

  const runner = {
    run(executable, args, options) {
      assert.equal(executable, gitCommand);
      assert.deepEqual(args, ['rev-parse', '--git-path', LOCK_FILE_NAME]);
      assert.equal(options.cwd, repositoryRoot);
      return {
        status: 0,
        stdout: `.git/${LOCK_FILE_NAME}\n`,
        stderr: '',
      };
    },
  };
  return {
    repositoryRoot,
    lockPath: path.join(gitDirectory, LOCK_FILE_NAME),
    lock: createRepositoryLock({ repositoryRoot, runner, gitCommand }),
  };
}

test('repository lock is exclusive and releases after successful work', (t) => {
  const fixture = createFixture(t);

  const value = fixture.lock.runExclusive(({ lockPath }) => {
    assert.equal(lockPath, fixture.lockPath);
    assert.equal(fs.existsSync(fixture.lockPath), true);
    assert.throws(
      () => fixture.lock.runExclusive(() => undefined),
      (error) => (
        error instanceof RepositoryLockError
        && error.code === 'LOCK_HELD'
      )
    );
    return 'complete';
  });

  assert.equal(value, 'complete');
  assert.equal(fs.existsSync(fixture.lockPath), false);
});

test('repository lock releases when protected work throws', (t) => {
  const fixture = createFixture(t);
  const operationError = new Error('operation failed');

  assert.throws(
    () => fixture.lock.runExclusive(() => {
      throw operationError;
    }),
    (error) => error === operationError
  );
  assert.equal(fs.existsSync(fixture.lockPath), false);
});

test('repository lock remains held until asynchronous work settles', async (t) => {
  const fixture = createFixture(t, { gitCommand: 'configured-git' });

  const result = await fixture.lock.runExclusive(async () => {
    assert.equal(fs.existsSync(fixture.lockPath), true);
    await Promise.resolve();
    assert.equal(fs.existsSync(fixture.lockPath), true);
    return 7;
  });

  assert.equal(result, 7);
  assert.equal(fs.existsSync(fixture.lockPath), false);
});
