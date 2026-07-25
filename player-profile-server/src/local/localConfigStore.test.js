const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  LocalConfigStore,
  validateLocalConfig,
} = require('./localConfigStore');

test('validates absolute repository paths and GitHub account names', () => {
  const result = validateLocalConfig({
    dataRepositoryPath: path.resolve('Volputas-Data'),
    githubName: 'neco-user',
  });
  assert.equal(result.githubName, 'neco-user');
  assert.equal(result.schemaVersion, 1);

  assert.throws(
    () => validateLocalConfig({ dataRepositoryPath: 'relative', githubName: 'neco' }),
    { code: 'INVALID_DATA_REPOSITORY_PATH' }
  );
  assert.throws(
    () => validateLocalConfig({ dataRepositoryPath: path.resolve('data'), githubName: '../neco' }),
    { code: 'INVALID_GITHUB_NAME' }
  );
});

test('writes and reads local configuration atomically', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'volputas-config-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new LocalConfigStore(path.join(directory, 'config.json'));
  const expected = {
    dataRepositoryPath: path.join(directory, 'Volputas-Data'),
    githubName: 'neco',
  };

  assert.equal(await store.read(), null);
  await store.write(expected);
  const actual = await store.read();
  assert.equal(actual.githubName, expected.githubName);
  assert.equal(actual.dataRepositoryPath, path.resolve(expected.dataRepositoryPath));
});
