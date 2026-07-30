const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LocalPopulationReportService,
  OnlinePopulationReportService,
  validatePopulationReport,
} = require('./populationReport');
const { pseudoId } = require('./pseudoId');

const SECRET = 'population-test-secret';

function reportFor(identity, overrides = {}) {
  return {
    generatedAt: '2026-07-28T00:00:00.000Z',
    realPopulation: 20,
    entries: [{
      pseudoId: pseudoId(identity, SECRET),
      verdict: 'minor',
      ratio: 0.1,
      nearestClusterSize: 2,
    }],
    ...overrides,
  };
}

test('population report validation rejects duplicates and impossible cluster sizes', () => {
  const duplicate = reportFor('alice');
  duplicate.entries.push({ ...duplicate.entries[0] });
  assert.throws(() => validatePopulationReport(duplicate), {
    code: 'INVALID_POPULATION_REPORT',
  });

  const impossible = reportFor('alice');
  impossible.entries[0].nearestClusterSize = 21;
  assert.throws(() => validatePopulationReport(impossible), {
    code: 'INVALID_POPULATION_REPORT',
  });
});

test('local population import updates only the matching v2 persona', async () => {
  let stored = {
    schemaVersion: 2,
    note: 'derived analysis',
    population: null,
  };
  const personaService = {
    async readAnalysis(repositoryRoot, name) {
      assert.equal(repositoryRoot, 'data-root');
      assert.equal(name, 'alice');
      return stored;
    },
    async writeAnalysis(repositoryRoot, name, analysis) {
      assert.equal(repositoryRoot, 'data-root');
      assert.equal(name, 'alice');
      stored = analysis;
    },
  };
  const service = new LocalPopulationReportService({
    personaService,
    secret: SECRET,
  });

  const result = await service.import(
    { repositoryRoot: 'data-root', name: 'alice' },
    reportFor('alice')
  );
  assert.deepEqual(result, {
    matched: true,
    updated: true,
    population: {
      generatedAt: '2026-07-28T00:00:00.000Z',
      realPopulation: 20,
      verdict: 'minor',
      ratio: 0.1,
      nearestClusterSize: 2,
    },
  });
  assert.equal(stored.note, 'derived analysis');
  assert.equal(JSON.stringify(stored).includes('alice'), false);

  const missing = await service.import(
    { repositoryRoot: 'data-root', name: 'alice' },
    reportFor('bob')
  );
  assert.deepEqual(missing, { matched: false, updated: false });
});

test('online population import considers only consented query results', async () => {
  const analyses = new Map([
    ['user-a', { schemaVersion: 2, population: null }],
    ['user-b', { schemaVersion: 1 }],
  ]);
  const writes = [];
  const service = new OnlinePopulationReportService({
    database: {
      async query(text) {
        assert.match(text, /research_export_consent = true/);
        return { rows: [{ user_id: 'user-a' }, { user_id: 'user-b' }] };
      },
    },
    evidenceStore: {
      async readAnalysis(userId) {
        return analyses.get(userId);
      },
      async writeAnalysis(userId, analysis) {
        writes.push({ userId, analysis });
      },
    },
    secret: SECRET,
  });
  const report = reportFor('user-a');
  report.entries.push({
    pseudoId: pseudoId('user-b', SECRET),
    verdict: 'major',
    ratio: 0.6,
    nearestClusterSize: 12,
  });

  const result = await service.import(report);
  assert.deepEqual(result, { received: 2, matched: 2, updated: 1 });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].userId, 'user-a');
  assert.equal(writes[0].analysis.population.verdict, 'minor');
  assert.equal(JSON.stringify(writes).includes('user-b'), false);
});
