const test = require('node:test');
const assert = require('node:assert/strict');
const { CORPUS_SERVICE_MANIFEST } = require('./manifest');

test('declares the Volputas backend without owning a Corpus frontend panel', () => {
  assert.equal(CORPUS_SERVICE_MANIFEST.service, 'volputas');
  assert.equal(CORPUS_SERVICE_MANIFEST.corpusApi, 1);
  assert.equal(CORPUS_SERVICE_MANIFEST.health, '/health');
  assert.equal(CORPUS_SERVICE_MANIFEST.auth, 'cernere-project-token');
  assert.equal(CORPUS_SERVICE_MANIFEST.cernereProjectKey, 'volputas');
  assert.deepEqual(CORPUS_SERVICE_MANIFEST.panels, []);
  assert.deepEqual(
    CORPUS_SERVICE_MANIFEST.data.map(({ id }) => id),
    ['survey-catalog', 'survey-detail', 'survey-response'],
  );
  assert.ok(CORPUS_SERVICE_MANIFEST.data.every(({ scope }) => scope === 'multi'));
});
