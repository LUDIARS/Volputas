const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { exportLocalPersona } = require('./localPersonaExport');

function personaAnalysis() {
  return {
    schemaVersion: 2,
    affect: { vector: Array(20).fill(0.1), vectorSpecVersion: 1 },
    preferenceAxes: {
      'style.explorer': { score: 0.8, confidence: 'medium' },
      'style.socializer': { score: null, confidence: 'insufficient' },
    },
    aversions: [],
    mechanicReactions: [],
    classification: { tags: ['探索型'] },
  };
}

async function setup(t, consent) {
  const repositoryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'volputas-export-'));
  t.after(() => fs.rm(repositoryRoot, { recursive: true, force: true }));
  const name = 'PrivateName';
  const analysisDirectory = path.join(repositoryRoot, 'analysis', name);
  await fs.mkdir(analysisDirectory, { recursive: true });
  await fs.writeFile(
    path.join(analysisDirectory, 'persona.json'),
    JSON.stringify(personaAnalysis()),
    'utf8'
  );
  return {
    config: {
      dataRepositoryPath: repositoryRoot,
      name,
      researchExportConsent: consent,
    },
    repositoryRoot,
  };
}

test('local export writes zero lines when research consent is off', async (t) => {
  const { config } = await setup(t, false);
  const result = await exportLocalPersona({ config, secret: 'test-secret' });
  assert.equal(result.count, 0);
  assert.equal(await fs.readFile(result.filePath, 'utf8'), '');
});

test('local export writes one pseudonymous JSONL line without Name or email', async (t) => {
  const { config } = await setup(t, true);
  const result = await exportLocalPersona({ config, secret: 'test-secret' });
  const text = await fs.readFile(result.filePath, 'utf8');
  const lines = text.trim().split('\n');
  assert.equal(result.count, 1);
  assert.equal(lines.length, 1);
  const exported = JSON.parse(lines[0]);
  assert.match(exported.pseudoId, /^ext:voluptas:[0-9a-f]{16}$/);
  assert.equal(exported.exportSpecVersion, 2);
  assert.equal(exported.preferenceAxes['style.explorer'], 0.8);
  assert.equal('style.socializer' in exported.preferenceAxes, false);
  assert.doesNotMatch(text, /PrivateName|email|display_name|sourceFingerprint/);
});
