'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  GithubRepositoryVisibilityError,
  assertPublicGithubRepository,
} = require('./githubRepositoryVisibility');

test('assertPublicGithubRepository accepts only the canonical public repository', () => {
  const calls = [];
  const metadata = assertPublicGithubRepository({
    cwd: '/work',
    repository: 'LUDIARS/VolputasData',
    runner: {
      run: (...args) => {
        calls.push(args);
        return {
          stdout: JSON.stringify({
            fullName: 'LUDIARS/VolputasData',
            visibility: 'public',
          }),
        };
      },
    },
  });

  assert.deepEqual(metadata, {
    fullName: 'LUDIARS/VolputasData',
    visibility: 'public',
  });
  assert.deepEqual(calls[0][1].slice(0, 2), [
    'api',
    'repos/LUDIARS/VolputasData',
  ]);
});

test('assertPublicGithubRepository fails closed for a private repository', () => {
  assert.throws(
    () => assertPublicGithubRepository({
      cwd: '/work',
      repository: 'LUDIARS/VolputasData',
      runner: {
        run: () => ({
          stdout: JSON.stringify({
            fullName: 'LUDIARS/VolputasData',
            visibility: 'private',
          }),
        }),
      },
    }),
    GithubRepositoryVisibilityError
  );
});

test('assertPublicGithubRepository does not expose malformed API output', () => {
  assert.throws(
    () => assertPublicGithubRepository({
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
