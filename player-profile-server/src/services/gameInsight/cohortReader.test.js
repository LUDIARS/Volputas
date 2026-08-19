const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { CohortReader } = require('./cohortReader');

test('cohort reader rejects non-object imported JSON records', async (t) => {
  const repositoryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'volputas-cohort-reader-'));
  t.after(() => fs.rm(repositoryRoot, { recursive: true, force: true }));
  const directory = path.join(repositoryRoot, 'emotion-curves', 'imported');
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'invalid.json'), 'null\n', 'utf8');

  await assert.rejects(
    new CohortReader().readAll({ repositoryRoot }),
    (error) => error.code === 'INVALID_PROFILE_RECORD'
  );
});
