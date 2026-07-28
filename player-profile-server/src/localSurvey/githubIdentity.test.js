'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  GithubIdentityError,
  normalizeGithubIdentity,
  resolveGithubIdentity,
} = require('./githubIdentity');

function captureError(operation, expected) {
  let captured;
  assert.throws(
    () => {
      try {
        operation();
      } catch (error) {
        captured = error;
        throw error;
      }
    },
    expected
  );
  return captured;
}

test('resolves only numeric id and login from the authenticated GitHub CLI user', () => {
  const calls = [];
  const runner = {
    run(executable, args, options) {
      calls.push({ executable, args, options });
      return {
        status: 0,
        stdout: '{"id":"12345678","login":"neco-player"}\n',
        stderr: '',
      };
    },
  };
  const cwd = path.resolve('fixture-repository');

  const identity = resolveGithubIdentity({
    cwd,
    runner,
    githubCommand: 'configured-gh',
  });

  assert.deepEqual(identity, {
    id: '12345678',
    login: 'neco-player',
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].executable, 'configured-gh');
  assert.deepEqual(calls[0].args.slice(0, 2), ['api', 'user']);
  assert.equal(calls[0].args.includes('token'), false);
  assert.equal(calls[0].options.cwd, cwd);
});

test('normalizes GitHub ids without using a mutable login as authority', () => {
  assert.deepEqual(
    normalizeGithubIdentity({ id: 42, login: 'old-login' }),
    { id: '42', login: 'old-login' }
  );
  assert.deepEqual(
    normalizeGithubIdentity({ id: '42', login: 'new-login' }),
    { id: '42', login: 'new-login' }
  );
  assert.throws(
    () => normalizeGithubIdentity({ id: '42', login: '../other-user' }),
    /GitHub login is invalid/
  );
});

test('invalid GitHub API data is never copied into the error', () => {
  const runner = {
    run() {
      return {
        status: 0,
        stdout: JSON.stringify({
          id: 'not-numeric',
          login: 'invalid--login',
          token: 'top-secret',
          name: 'Private Profile Name',
        }),
        stderr: '',
      };
    },
  };

  const error = captureError(
    () => resolveGithubIdentity({
      cwd: path.resolve('fixture-repository'),
      runner,
    }),
    GithubIdentityError
  );

  assert.doesNotMatch(
    error.message,
    /top-secret|Private Profile Name|invalid--login|not-numeric/
  );
});

test('GitHub CLI failures are wrapped without retaining sensitive details', () => {
  const runner = {
    run() {
      throw new Error('token top-secret is invalid');
    },
  };

  const error = captureError(
    () => resolveGithubIdentity({
      cwd: path.resolve('fixture-repository'),
      runner,
    }),
    GithubIdentityError
  );

  assert.doesNotMatch(error.message, /token|top-secret/);
  assert.equal(Object.hasOwn(error, 'cause'), false);
});
