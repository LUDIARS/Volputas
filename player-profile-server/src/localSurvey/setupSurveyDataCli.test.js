'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const { main } = require('../../scripts/setup-survey-data');

function captureStream() {
  let value = '';
  return {
    stream: { write(chunk) { value += chunk; } },
    read: () => value,
  };
}

// `git rev-parse --show-toplevel` reports the resolved real path, while os.tmpdir() is
// a symlink on macOS (/var -> /private/var) and can be an 8.3 short path on Windows.
// Without realpathSync here, assertExistingClone would compare two spellings of the
// same directory and report a nested repository on those platforms.
function createExistingClone(t, originUrl) {
  const created = fs.mkdtempSync(path.join(os.tmpdir(), 'volputas-setup-survey-data-'));
  t.after(() => fs.rmSync(created, { recursive: true, force: true }));
  const target = fs.realpathSync(created);
  execFileSync('git', ['init', target], { windowsHide: true, stdio: 'ignore' });
  execFileSync('git', ['-C', target, 'remote', 'add', 'origin', originUrl], {
    windowsHide: true,
    stdio: 'ignore',
  });
  fs.writeFileSync(path.join(target, 'placeholder.txt'), 'existing clone\n', 'utf8');
  return target;
}

function baseConfig(overrides = {}) {
  return {
    serverRoot: path.resolve('.'),
    dataRepositoryRoot: path.resolve('private', 'survey-data'),
    githubRepository: 'acme/volputas-data',
    expectedRemoteUrl: 'https://github.com/acme/volputas-data.git',
    baseBranch: 'main',
    githubCommand: 'gh',
    gitCommand: 'git',
    ...overrides,
  };
}

test('clones the repository named by config/local-survey.json, not a hardcoded default', async () => {
  const output = captureStream();
  const errorOutput = captureStream();
  const config = baseConfig({ gitCommand: '/opt/git/bin/git' });
  let cloneInput = null;

  const exitCode = main({ output: output.stream, errorOutput: errorOutput.stream }, {
    loadConfig: () => config,
    assertPrivateRepository: () => ({ isPrivate: true, visibility: 'private' }),
    createRunner: () => ({ run: () => ({ stdout: '' }) }),
    existsSync: () => false,
    statSync: () => ({ isDirectory: () => false }),
    readdirSync: () => [],
    mkdirSync: () => {},
    cloneRepository: (input) => {
      cloneInput = input;
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(cloneInput, {
    repositoryUrl: config.expectedRemoteUrl,
    baseBranch: config.baseBranch,
    dataRoot: config.dataRepositoryRoot,
    cwd: config.serverRoot,
    // `commands.git` from config/local-survey.json, not a hardcoded PATH lookup.
    gitCommand: '/opt/git/bin/git',
  });
  assert.match(output.read(), /Data repository is ready/);
});

test('rejects the configured repository when it is not private, before declaring success', async () => {
  const output = captureStream();
  const errorOutput = captureStream();
  let privateCheckedRepository = null;

  const exitCode = main({ output: output.stream, errorOutput: errorOutput.stream }, {
    loadConfig: () => baseConfig(),
    assertPrivateRepository: ({ repository }) => {
      privateCheckedRepository = repository;
      throw Object.assign(new Error(
        'The configured data repository is not the expected private repository.'
      ), { code: 'DATA_REPOSITORY_UNAVAILABLE' });
    },
    createRunner: () => ({ run: () => ({ stdout: '' }) }),
    existsSync: () => false,
    statSync: () => ({ isDirectory: () => false }),
    readdirSync: () => [],
    mkdirSync: () => {},
    cloneRepository: () => {},
  });

  assert.equal(exitCode, 1);
  assert.equal(privateCheckedRepository, 'acme/volputas-data');
  assert.match(errorOutput.read(), /not the expected private repository/);
  assert.doesNotMatch(output.read(), /Data repository is ready/);
});

test('does not reclone an existing checkout that already matches the configured origin', async (t) => {
  const expectedRemoteUrl = 'https://github.com/acme/volputas-data.git';
  const target = createExistingClone(t, expectedRemoteUrl);

  const output = captureStream();
  const errorOutput = captureStream();
  let cloned = false;

  const exitCode = main({ output: output.stream, errorOutput: errorOutput.stream }, {
    loadConfig: () => baseConfig({ dataRepositoryRoot: target, expectedRemoteUrl }),
    assertPrivateRepository: () => ({ isPrivate: true, visibility: 'private' }),
    createRunner: () => ({ run: () => ({ stdout: '' }) }),
    cloneRepository: () => {
      cloned = true;
    },
  });

  assert.equal(cloned, false, 'an already-correct clone must not be recloned');
  assert.equal(exitCode, 0);
  assert.match(output.read(), /Data repository is ready/);
});

test('rejects an existing directory whose origin does not match the configured repository', async (t) => {
  const target = createExistingClone(t, 'https://github.com/other/repo.git');

  const errorOutput = captureStream();
  const exitCode = main({ errorOutput: errorOutput.stream }, {
    loadConfig: () => baseConfig({
      dataRepositoryRoot: target,
      expectedRemoteUrl: 'https://github.com/acme/volputas-data.git',
    }),
    assertPrivateRepository: () => ({ isPrivate: true, visibility: 'private' }),
    createRunner: () => ({ run: () => ({ stdout: '' }) }),
    cloneRepository: () => {
      throw new Error('must not clone over a mismatched existing directory');
    },
  });

  assert.equal(exitCode, 1);
  assert.match(errorOutput.read(), /does not match the configured data repository/);
});

// The Git workflow contract keeps credentials out of URLs, stdout and stderr. A clone
// made with a tokenized remote still has to be reported as a mismatch, but the token
// itself must not reach the operator's terminal or their shell transcript.
test('does not echo an embedded credential from a mismatched origin', async (t) => {
  const token = 'ghp-not-a-real-token';
  const target = createExistingClone(
    t,
    `https://x-access-token:${token}@github.com/other/repo.git`
  );

  const errorOutput = captureStream();
  const exitCode = main({ errorOutput: errorOutput.stream }, {
    loadConfig: () => baseConfig({
      dataRepositoryRoot: target,
      expectedRemoteUrl: 'https://github.com/acme/volputas-data.git',
    }),
    assertPrivateRepository: () => ({ isPrivate: true, visibility: 'private' }),
    createRunner: () => ({ run: () => ({ stdout: '' }) }),
    cloneRepository: () => {
      throw new Error('must not clone over a mismatched existing directory');
    },
  });

  assert.equal(exitCode, 1);
  const reported = errorOutput.read();
  assert.match(reported, /does not match the configured data repository/);
  assert.ok(!reported.includes(token), 'the embedded credential must not be printed');
  assert.ok(!reported.includes('x-access-token'), 'the userinfo must not be printed');
});

// Git accepts the SCP-style remote spelling too, and it has no `://` for the scheme
// form of the credential strip to anchor on. A token embedded there must be dropped
// on the same path, not printed because the URL took the other spelling.
test('does not echo an embedded credential from an SCP-style mismatched origin', async (t) => {
  const token = 'ghp-not-a-real-token';
  const target = createExistingClone(
    t,
    `x-access-token:${token}@github.com:other/repo.git`
  );

  const errorOutput = captureStream();
  const exitCode = main({ errorOutput: errorOutput.stream }, {
    loadConfig: () => baseConfig({
      dataRepositoryRoot: target,
      expectedRemoteUrl: 'https://github.com/acme/volputas-data.git',
    }),
    assertPrivateRepository: () => ({ isPrivate: true, visibility: 'private' }),
    createRunner: () => ({ run: () => ({ stdout: '' }) }),
    cloneRepository: () => {
      throw new Error('must not clone over a mismatched existing directory');
    },
  });

  assert.equal(exitCode, 1);
  const reported = errorOutput.read();
  assert.match(reported, /does not match the configured data repository/);
  assert.ok(!reported.includes(token), 'the embedded credential must not be printed');
  assert.ok(!reported.includes('x-access-token'), 'the userinfo must not be printed');
});
