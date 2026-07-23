'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  UnsafeRepositoryPathError,
  ensureSafeRepositoryDirectory,
} = require('./safeRepositoryPath');

function createFixture(t) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'voluptas-path-'));
  const repositoryRoot = path.join(fixtureRoot, 'repository');
  fs.mkdirSync(repositoryRoot);
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  return { fixtureRoot, repositoryRoot };
}

test('creates a canonical directory contained by the repository', (t) => {
  const { repositoryRoot } = createFixture(t);
  const directory = path.join(repositoryRoot, 'responses', 'github-42');

  const result = ensureSafeRepositoryDirectory(repositoryRoot, directory);

  assert.equal(result, directory);
  assert.equal(fs.statSync(directory).isDirectory(), true);
});

test('rejects lexical paths outside the repository', (t) => {
  const { fixtureRoot, repositoryRoot } = createFixture(t);

  assert.throws(
    () => ensureSafeRepositoryDirectory(
      repositoryRoot,
      path.join(fixtureRoot, 'outside')
    ),
    (error) => (
      error instanceof UnsafeRepositoryPathError
      && error.code === 'PATH_OUTSIDE_REPOSITORY'
    )
  );
});

test('rejects a symlink or junction in a generated directory path', (t) => {
  const { fixtureRoot, repositoryRoot } = createFixture(t);
  const outsideRoot = path.join(fixtureRoot, 'outside');
  fs.mkdirSync(outsideRoot);

  try {
    fs.symlinkSync(
      outsideRoot,
      path.join(repositoryRoot, 'responses'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
  } catch (error) {
    if (error && ['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) {
      t.skip('directory links are unavailable in this environment');
      return;
    }
    throw error;
  }

  assert.throws(
    () => ensureSafeRepositoryDirectory(
      repositoryRoot,
      path.join(repositoryRoot, 'responses', 'github-42')
    ),
    (error) => (
      error instanceof UnsafeRepositoryPathError
      && ['UNSAFE_DIRECTORY_TYPE', 'DIRECTORY_LINK_DETECTED'].includes(error.code)
    )
  );
  assert.deepEqual(fs.readdirSync(outsideRoot), []);
});
