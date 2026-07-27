const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { GitAuthorReader } = require('./gitAuthorReader');

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
