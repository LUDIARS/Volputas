const test = require('node:test');
const assert = require('node:assert/strict');
const { CORPUS_SERVICE_MANIFEST } = require('./manifest');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { VOLUPTAS_PROJECT_KEY } = require('../integrations/cernere/glabDelegation');

test('declares the Voluptas backend without owning a Corpus frontend panel', () => {
  assert.equal(CORPUS_SERVICE_MANIFEST.service, 'voluptas');
  assert.equal(CORPUS_SERVICE_MANIFEST.corpusApi, 1);
  assert.equal(CORPUS_SERVICE_MANIFEST.health, '/health');
  assert.equal(CORPUS_SERVICE_MANIFEST.auth, 'cernere-delegated-operation');
  assert.equal(CORPUS_SERVICE_MANIFEST.cernereProjectKey, 'voluptas');
  assert.equal(VOLUPTAS_PROJECT_KEY, CORPUS_SERVICE_MANIFEST.cernereProjectKey);
  const catalog = readFileSync(resolve(__dirname, '../../../excubitor.catalog.yaml'), 'utf8');
  const targets = [...catalog.matchAll(/cernere_launch_credentials:\s*\n\s*target_project:\s*(\S+)/g)].map(match => match[1]);
  assert.ok(targets.length > 0); assert.ok(targets.every(target => target === VOLUPTAS_PROJECT_KEY));
  assert.deepEqual(CORPUS_SERVICE_MANIFEST.panels, []);
  assert.deepEqual(
    CORPUS_SERVICE_MANIFEST.data.map(({ id }) => id),
    ['survey-catalog', 'survey-detail', 'survey-response'],
  );
  assert.ok(CORPUS_SERVICE_MANIFEST.data.every(({ scope }) => scope === 'multi'));
  assert.deepEqual(CORPUS_SERVICE_MANIFEST.data.map(({ delegation }) => delegation), [
    { GET: { action: 'survey.list' } }, { GET: { action: 'survey.read' } }, { PUT: { action: 'survey.respond' } },
  ]);
});
