'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  GithubRepositoryVisibilityError,
  assertPrivateGithubRepository,
} = require('./githubRepositoryVisibility');

test('assertPrivateGithubRepository accepts only the canonical private repository', () => {
  const calls = [];
  const metadata = assertPrivateGithubRepository({
    cwd: '/work',
    repository: 'LUDIARS/VolputasData',
    runner: {
      run: (...args) => {
        calls.push(args);
        return {
          stdout: JSON.stringify({
            fullName: 'LUDIARS/VolputasData',
            private: true,
            visibility: 'private',
          }),
        };
      },
    },
  });

  assert.deepEqual(metadata, {
    fullName: 'LUDIARS/VolputasData',
    isPrivate: true,
    visibility: 'private',
  });
  assert.deepEqual(calls[0][1].slice(0, 2), [
    'api',
    'repos/LUDIARS/VolputasData',
  ]);
});

test('assertPrivateGithubRepository fails closed for a public repository', () => {
  assert.throws(
    () => assertPrivateGithubRepository({
      cwd: '/work',
      repository: 'LUDIARS/VolputasData',
      runner: {
        run: () => ({
          stdout: JSON.stringify({
            fullName: 'LUDIARS/VolputasData',
            private: false,
            visibility: 'public',
          }),
        }),
      },
    }),
    GithubRepositoryVisibilityError
  );
});

test('assertPrivateGithubRepository rejects an internal repository', () => {
  // `private: true` alone is not enough: an internal repository is visible to the whole
  // enterprise, which is not the audience a respondent consented to.
  assert.throws(
    () => assertPrivateGithubRepository({
      cwd: '/work',
      repository: 'LUDIARS/VolputasData',
      runner: {
        run: () => ({
          stdout: JSON.stringify({
            fullName: 'LUDIARS/VolputasData',
            private: true,
            visibility: 'internal',
          }),
        }),
      },
    }),
    GithubRepositoryVisibilityError
  );
});

test('assertPrivateGithubRepository rejects a different repository', () => {
  assert.throws(
    () => assertPrivateGithubRepository({
      cwd: '/work',
      repository: 'LUDIARS/VolputasData',
      runner: {
        run: () => ({
          stdout: JSON.stringify({
            fullName: 'someone-else/VolputasData',
            private: true,
            visibility: 'private',
          }),
        }),
      },
    }),
    GithubRepositoryVisibilityError
  );
});

test('assertPrivateGithubRepository does not expose malformed API output', () => {
  assert.throws(
    () => assertPrivateGithubRepository({
      cwd: '/work',
      repository: 'LUDIARS/VolputasData',
      runner: {
        run: () => ({ stdout: 'secret-profile-data' }),
      },
    }),
    (error) => (
      error instanceof GithubRepositoryVisibilityError
      && !error.message.includes('secret-profile-data')
    )
  );
});
