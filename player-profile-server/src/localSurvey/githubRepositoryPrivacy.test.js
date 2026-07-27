'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  GithubRepositoryPrivacyError,
  assertPrivateGithubRepository,
} = require('./githubRepositoryPrivacy');

test('assertPrivateGithubRepository accepts only the configured private repository', () => {
  const calls = [];
  const metadata = assertPrivateGithubRepository({
    cwd: '/work',
    repository: 'LUDIARS/Voluptas-Data',
    runner: {
      run: (...args) => {
        calls.push(args);
        return {
          stdout: JSON.stringify({
            fullName: 'LUDIARS/Voluptas-Data',
            isPrivate: true,
          }),
        };
      },
    },
  });

  assert.deepEqual(metadata, {
    fullName: 'LUDIARS/Voluptas-Data',
    isPrivate: true,
  });
  assert.deepEqual(calls[0][1].slice(0, 2), [
    'api',
    'repos/LUDIARS/Voluptas-Data',
  ]);
});

test('assertPrivateGithubRepository fails closed for a public repository', () => {
  assert.throws(
    () => assertPrivateGithubRepository({
      cwd: '/work',
      repository: 'LUDIARS/Voluptas-Data',
      runner: {
        run: () => ({
          stdout: JSON.stringify({
            fullName: 'LUDIARS/Voluptas-Data',
            isPrivate: false,
          }),
        }),
      },
    }),
    GithubRepositoryPrivacyError
  );
});

test('assertPrivateGithubRepository does not expose malformed API output', () => {
  assert.throws(
    () => assertPrivateGithubRepository({
      cwd: '/work',
      repository: 'LUDIARS/Voluptas-Data',
      runner: {
        run: () => ({ stdout: 'secret-profile-data' }),
      },
    }),
    (error) => (
      error instanceof GithubRepositoryPrivacyError
      && !error.message.includes('secret-profile-data')
    )
  );
});
