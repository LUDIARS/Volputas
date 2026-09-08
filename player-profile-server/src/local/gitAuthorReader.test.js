const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { GitAuthorReader, parseGithubOwnerRepo } = require('./gitAuthorReader');

test('reads repository root and Git author using argument-array git calls', async () => {
  const repositoryRoot = path.resolve('Volputas-Data');
  const calls = [];
  const reader = new GitAuthorReader(async (args) => {
    calls.push(args);
    const key = args.at(-1);
    if (key === '--show-toplevel') return { stdout: `${repositoryRoot}\n` };
    if (key === 'user.name') return { stdout: 'Neco\n' };
    if (key === 'user.email') return { stdout: 'neco@example.test\n' };
    if (key === 'remote.origin.url') {
      return { stdout: 'git@github.com:LUDIARS/Volputas-Data.git\n' };
    }
    throw new Error(`Unexpected git call: ${args.join(' ')}`);
  });

  const author = await reader.read(repositoryRoot);
  assert.deepEqual(author, {
    repositoryRoot,
    name: 'Neco',
    email: 'neco@example.test',
    remoteUrl: 'git@github.com:LUDIARS/Volputas-Data.git',
  });
  assert.equal(calls.length, 4);
  assert.ok(calls.every((args) => args[0] === '-C'));
});

test('fails clearly when Git author configuration is missing', async () => {
  const reader = new GitAuthorReader(async (args) => {
    if (args.at(-1) === '--show-toplevel') return { stdout: `${path.resolve('data')}\n` };
    return { stdout: '\n' };
  });

  await assert.rejects(() => reader.read(path.resolve('data')), {
    code: 'GIT_AUTHOR_UNAVAILABLE',
  });
});

test('rejects a data repository whose origin is not GitHub', async () => {
  const reader = new GitAuthorReader(async (args) => {
    const key = args.at(-1);
    if (key === '--show-toplevel') return { stdout: `${path.resolve('data')}\n` };
    if (key === 'user.name') return { stdout: 'Neco\n' };
    if (key === 'user.email') return { stdout: 'neco@example.test\n' };
    return { stdout: 'https://example.test/neco/data.git\n' };
  });

  await assert.rejects(() => reader.read(path.resolve('data')), {
    code: 'GITHUB_REMOTE_REQUIRED',
  });
});

test('parseGithubOwnerRepo extracts owner/repo from every accepted remote form', () => {
  assert.equal(
    parseGithubOwnerRepo('git@github.com:acme/volputas-data.git'),
    'acme/volputas-data'
  );
  assert.equal(
    parseGithubOwnerRepo('git@github.com:acme/volputas-data'),
    'acme/volputas-data'
  );
  assert.equal(
    parseGithubOwnerRepo('ssh://git@github.com/acme/volputas-data.git'),
    'acme/volputas-data'
  );
  assert.equal(
    parseGithubOwnerRepo('https://github.com/acme/volputas-data.git'),
    'acme/volputas-data'
  );
  assert.equal(
    parseGithubOwnerRepo('https://github.com/acme/volputas-data'),
    'acme/volputas-data'
  );
});

test('parseGithubOwnerRepo rejects a non-GitHub remote', () => {
  assert.throws(
    () => parseGithubOwnerRepo('https://example.test/acme/volputas-data.git'),
    { code: 'GITHUB_REMOTE_REQUIRED' }
  );
});

// The parsed owner/repo is interpolated into the `gh api repos/<owner>/<repo>` path
// used for the private-visibility check; a remote must never be able to steer that
// path at another resource or smuggle characters into it.
test('parseGithubOwnerRepo rejects remotes that could re-point the GitHub API path', () => {
  for (const remoteUrl of [
    'https://github.com/../volputas-data',
    'https://github.com/acme/..',
    'https://github.com/acme/./volputas-data',
    'https://github.com/acme/volputas data',
    'https://github.com/acme/volputas%2fdata',
  ]) {
    assert.throws(
      () => parseGithubOwnerRepo(remoteUrl),
      { code: 'GITHUB_REMOTE_REQUIRED' },
      `expected ${remoteUrl} to be rejected`
    );
  }
});
