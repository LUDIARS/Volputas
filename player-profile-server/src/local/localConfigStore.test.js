const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  LocalConfigStore,
  validateLocalConfig,
} = require('./localConfigStore');

test('validates absolute repository paths and portable Git Author folder names', () => {
  const result = validateLocalConfig({
    dataRepositoryPath: path.resolve('Volputas-Data'),
    name: 'k.mitarai',
  });
  assert.equal(result.name, 'k.mitarai');
  assert.equal(result.schemaVersion, 2);
  assert.equal(result.researchExportConsent, false);

  assert.throws(
    () => validateLocalConfig({ dataRepositoryPath: 'relative', name: 'neco' }),
    { code: 'INVALID_DATA_REPOSITORY_PATH' }
  );
  assert.throws(
    () => validateLocalConfig({ dataRepositoryPath: path.resolve('data'), name: '../neco' }),
    { code: 'INVALID_ANSWER_OWNER_NAME' }
  );
  assert.throws(
    () => validateLocalConfig({ dataRepositoryPath: path.resolve('data'), name: 'CON' }),
    { code: 'INVALID_ANSWER_OWNER_NAME' }
  );
});

test('migrates the legacy githubName setting to Name', () => {
  const config = validateLocalConfig({
    dataRepositoryPath: path.resolve('Volputas-Data'),
    githubName: 'legacy-name',
  });
  assert.equal(config.name, 'legacy-name');
  assert.equal(config.githubName, undefined);
  assert.equal(config.schemaVersion, 2);
});

test('writes and reads local configuration atomically', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'volputas-config-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new LocalConfigStore(path.join(directory, 'config.json'));
  const expected = {
    dataRepositoryPath: path.join(directory, 'Volputas-Data'),
    name: 'neco',
    researchExportConsent: true,
  };

  assert.equal(await store.read(), null);
  await store.write(expected);
  const actual = await store.read();
  assert.equal(actual.name, expected.name);
  assert.equal(actual.dataRepositoryPath, path.resolve(expected.dataRepositoryPath));
  assert.equal(actual.researchExportConsent, true);
});
