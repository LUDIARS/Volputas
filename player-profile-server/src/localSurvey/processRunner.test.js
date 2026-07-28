'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  ProcessExecutionError,
  createProcessRunner,
} = require('./processRunner');

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

test('process runner uses an explicit cwd and never invokes a shell', () => {
  const calls = [];
  const runner = createProcessRunner({
    spawnSync(executable, args, options) {
      calls.push({ executable, args, options });
      return {
        status: 0,
        signal: null,
        stdout: 'result\n',
        stderr: '',
      };
    },
  });
  const cwd = path.resolve('fixture-repository');

  const result = runner.run('git', ['status', '--short'], { cwd });

  assert.deepEqual(result, {
    status: 0,
    signal: null,
    stdout: 'result\n',
    stderr: '',
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].executable, 'git');
  assert.deepEqual(calls[0].args, ['status', '--short']);
  assert.equal(calls[0].options.cwd, cwd);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.encoding, 'utf8');
  assert.deepEqual(calls[0].options.stdio, ['ignore', 'pipe', 'pipe']);
  assert.equal(calls[0].options.windowsHide, true);
});

test('process runner returns explicitly allowed nonzero exit codes', () => {
  const runner = createProcessRunner({
    spawnSync() {
      return {
        status: 1,
        signal: null,
        stdout: '',
        stderr: 'expected probe miss',
      };
    },
  });

  const result = runner.run(
    'git',
    ['show-ref', '--verify', '--quiet', 'refs/heads/missing'],
    {
      cwd: path.resolve('fixture-repository'),
      allowedExitCodes: [0, 1],
    }
  );

  assert.equal(result.status, 1);
});

test('process failures do not expose arguments or captured output', () => {
  const runner = createProcessRunner({
    spawnSync() {
      return {
        status: 9,
        signal: null,
        stdout: 'private response body',
        stderr: 'token=top-secret',
      };
    },
  });

  const error = captureError(
    () => runner.run(
      'git',
      ['commit', '--message', 'private response body'],
      { cwd: path.resolve('fixture-repository') }
    ),
    ProcessExecutionError
  );

  assert.equal(error.exitCode, 9);
  assert.doesNotMatch(error.message, /private response body|top-secret|commit/i);
  assert.equal(Object.hasOwn(error, 'stdout'), false);
  assert.equal(Object.hasOwn(error, 'stderr'), false);
  assert.equal(Object.hasOwn(error, 'args'), false);
});

test('spawn exceptions are replaced by sanitized process errors', () => {
  const runner = createProcessRunner({
    spawnSync() {
      throw new Error('credential top-secret was rejected');
    },
  });

  const error = captureError(
    () => runner.run('gh', ['api', 'user'], {
      cwd: path.resolve('fixture-repository'),
    }),
    ProcessExecutionError
  );

  assert.doesNotMatch(error.message, /credential|top-secret/);
  assert.equal(error.reason, 'spawn-threw');
});

test('process runner rejects an implicit cwd before spawning', () => {
  let didSpawn = false;
  const runner = createProcessRunner({
    spawnSync() {
      didSpawn = true;
      return { status: 0, stdout: '', stderr: '' };
    },
  });

  assert.throws(
    () => runner.run('git', ['status']),
    /cwd must be an explicit absolute path/
  );
  assert.equal(didSpawn, false);
});
