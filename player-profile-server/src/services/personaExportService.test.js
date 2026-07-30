const test = require('node:test');
const assert = require('node:assert/strict');
const { PersonaExportService, normalizePageSize } = require('./personaExportService');

function analysis(score) {
  return {
    schemaVersion: 2,
    affect: null,
    preferenceAxes: {
      'style.explorer': { score, confidence: 'low' },
    },
    aversions: [],
    mechanicReactions: [],
  };
}

test('online export pages only database-consented users and reads derived personas', async () => {
  const queries = [];
  const database = {
    async query(sql, parameters) {
      queries.push({ sql, parameters });
      return {
        rows: [
          { user_id: '11111111-1111-4111-8111-111111111111', playstyle_tags: ['探索型'] },
          { user_id: '22222222-2222-4222-8222-222222222222', playstyle_tags: [] },
        ],
      };
    },
  };
  const evidenceStore = {
    async readAnalysis(userId) {
      return analysis(userId.startsWith('1') ? 0.8 : 0.4);
    },
  };
  const service = new PersonaExportService({
    database,
    evidenceStore,
    secret: 'test-secret',
  });
  const result = await service.listPage({ limit: 1 });
  assert.equal(result.personas.length, 1);
  assert.equal(result.personas[0].preferenceAxes['style.explorer'], 0.8);
  assert.equal(result.nextCursor, '11111111-1111-4111-8111-111111111111');
  assert.match(queries[0].sql, /research_export_consent = true/);
  assert.deepEqual(queries[0].parameters, [null, 2]);
});

test('online export page size is bounded', () => {
  assert.equal(normalizePageSize(undefined), 100);
  assert.equal(normalizePageSize('0'), 100);
  assert.equal(normalizePageSize('900'), 500);
});

test('online export fails closed before querying when the pseudonym secret is absent', async () => {
  let queried = false;
  const service = new PersonaExportService({
    database: { query: async () => { queried = true; } },
    evidenceStore: {},
    secret: '',
  });
  await assert.rejects(() => service.listPage(), {
    code: 'PERSONA_EXPORT_UNAVAILABLE',
    statusCode: 503,
  });
  assert.equal(queried, false);
});
