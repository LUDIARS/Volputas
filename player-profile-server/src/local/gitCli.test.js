const test = require('node:test');
const assert = require('node:assert/strict');
const { GitCli } = require('./gitCli');

test('reports the Git CLI version when git is available in PATH', async () => {
  const gitCli = new GitCli(async (args) => {
    assert.deepEqual(args, ['--version']);
    return { stdout: 'git version 2.50.0\n' };
  });

  assert.deepEqual(await gitCli.inspect(), {
    available: true,
    version: 'git version 2.50.0',
  });
});

test('reports and rejects a missing Git CLI', async () => {
  const gitCli = new GitCli(async () => {
    throw Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' });
  });

  assert.deepEqual(await gitCli.inspect(), {
    available: false,
    version: null,
    error: 'Git CLI was not found in PATH',
  });
  await assert.rejects(() => gitCli.assertAvailable(), {
    code: 'GIT_CLI_UNAVAILABLE',
  });
});
