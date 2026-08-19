const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { AnatomiaClient, assertProjectName } = require('./anatomiaClient');

function fakeSpawn(stdoutText, exitCode = 0) {
  const calls = [];
  const spawnImpl = (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stdout.setEncoding = () => {};
    child.stderr = new EventEmitter();
    child.stderr.setEncoding = () => {};
    child.kill = () => {};
    setImmediate(() => {
      child.stdout.emit('data', stdoutText);
      child.emit('close', exitCode);
    });
    return child;
  };
  return { spawnImpl, calls };
}

test('unconfigured client fails fast with ANATOMIA_NOT_CONFIGURED', async () => {
  const client = new AnatomiaClient({ cliPath: '' });
  assert.equal(client.isConfigured(), false);
  await assert.rejects(client.context('proj', 'task'), (error) => error.code === 'ANATOMIA_NOT_CONFIGURED');
});

test('project names are restricted to a safe charset', () => {
  assert.equal(assertProjectName(' my-game.v2 '), 'my-game.v2');
  assert.throws(() => assertProjectName('a b'), (error) => error.code === 'INVALID_ANATOMIA_PROJECT');
  assert.throws(() => assertProjectName('../x'), (error) => error.code === 'INVALID_ANATOMIA_PROJECT');
});

test('context runs the CLI without a shell and reduces the bundle', async () => {
  const bundle = {
    existingDomains: ['combat', 'ui'],
    exemplars: [{ name: 'spawnBoss', signature: 'function spawnBoss(\n  id)', sourceRange: { start: { line: 10 }, end: { line: 30 }, filePath: 'E:/g/src/boss.ts' } }],
  };
  const { spawnImpl, calls } = fakeSpawn(`[anatomia/vestigium] noise\n${JSON.stringify(bundle)}`);
  const client = new AnatomiaClient({ cliPath: 'E:/A/bin/anatomia.mjs', nodePath: 'node', spawnImpl });
  const result = await client.context('my-game', 'Boss fight stress');
  assert.deepEqual(calls[0].args, ['E:/A/bin/anatomia.mjs', 'context', '--project', 'my-game', '--task', 'Boss fight stress']);
  assert.equal(calls[0].options.shell, undefined);
  assert.deepEqual(result.existingDomains, ['combat', 'ui']);
  assert.deepEqual(result.exemplars, [{ name: 'spawnBoss', filePath: 'E:/g/src/boss.ts', startLine: 10, endLine: 30, signature: 'function spawnBoss( id)' }]);
});

test('findSymbol handles "(no hits)" and json hits, and skips non-identifiers', async () => {
  const none = new AnatomiaClient({ cliPath: 'x.mjs', spawnImpl: fakeSpawn('(no hits)').spawnImpl });
  assert.deepEqual(await none.findSymbol('p', 'spawnBoss'), []);
  const hits = new AnatomiaClient({
    cliPath: 'x.mjs',
    spawnImpl: fakeSpawn(JSON.stringify({ hits: [{ name: 'spawnBoss', filePath: 'a.ts', startLine: 1, endLine: 2, signature: 's' }] })).spawnImpl,
  });
  assert.deepEqual(await hits.findSymbol('p', 'spawnBoss'), [{ name: 'spawnBoss', filePath: 'a.ts', startLine: 1, endLine: 2, signature: 's' }]);
  assert.deepEqual(await hits.findSymbol('p', 'ボス'), []);
});

test('non-zero exit surfaces as ANATOMIA_FAILED', async () => {
  const client = new AnatomiaClient({ cliPath: 'x.mjs', spawnImpl: fakeSpawn('', 1).spawnImpl });
  await assert.rejects(client.context('p', 't'), (error) => error.code === 'ANATOMIA_FAILED');
});
