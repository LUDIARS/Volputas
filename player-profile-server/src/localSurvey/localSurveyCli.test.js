'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { main } = require('../../scripts/run-local-survey');

function captureStream() {
  let value = '';
  return {
    stream: {
      write(chunk) {
        value += chunk;
      },
    },
    read: () => value,
  };
}

test('CLI does not expose a rejected --answers path', async () => {
  const output = captureStream();
  const errorOutput = captureStream();
  const sensitivePath = 'private-answer-never-log.json';
  const exitCode = await main({
    argv: ['--answers', sensitivePath, '--save-only'],
    cwd: path.resolve('missing-answer-fixture'),
    env: {},
    output: output.stream,
    errorOutput: errorOutput.stream,
  }, {
    loadConfig: () => ({
      serverRoot: path.resolve('.'),
      githubCommand: 'gh',
      gitCommand: 'git',
      githubRepository: 'LUDIARS/VolputasData',
    }),
    createRunner: () => ({ run: () => ({ stdout: '' }) }),
    resolveIdentity: () => ({ id: '42', login: 'player' }),
    assertPublicRepository: () => ({ visibility: 'public' }),
  });

  assert.equal(exitCode, 1);
  assert.match(output.read(), /GitHub identity: @player \(42\)/);
  assert.match(errorOutput.read(), /Answers file is unavailable/);
  assert.doesNotMatch(errorOutput.read(), /private-answer-never-log/);
});

test('CLI entrypoint accepts no runtime argument and renders help', async () => {
  const originalArgv = process.argv;
  const originalStdoutWrite = process.stdout.write;
  let output = '';
  process.argv = ['node', 'run-local-survey.js', '--help'];
  process.stdout.write = (chunk) => {
    output += chunk;
    return true;
  };

  try {
    const exitCode = await main();
    assert.equal(exitCode, 0);
    assert.match(output, /Volputas local OKF survey/);
  } finally {
    process.argv = originalArgv;
    process.stdout.write = originalStdoutWrite;
  }
});
