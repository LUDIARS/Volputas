const test = require('node:test');
const assert = require('node:assert/strict');
const { NarrativeArcService, arcRecordId } = require('./narrativeArcService');
const { SYSTEM_PROMPT, buildNarrativeArcPrompt } = require('./narrativeArcPrompt');

const CONTEXT = { repositoryRoot: '/repo', name: 'tester' };

function fakeStore(initial = []) {
  const records = new Map(initial.map((record) => [record.id, record]));
  let sequence = 0;
  return {
    records,
    async list() { return [...records.values()]; },
    async write({ data }) {
      const id = data.id || `record-${(sequence += 1)}`;
      const record = { schemaVersion: 1, ...data, id, createdAt: records.get(id)?.createdAt || '2026-08-10T00:00:00.000Z' };
      records.set(id, record);
      return { filePath: `/repo/${id}.json`, record };
    },
  };
}

function curve(id, gameTitle, entries, extra = {}) {
  return {
    id,
    gameTitle,
    mode: 'video',
    respondent: { name: 'tester' },
    sessionPlaytimeMinutes: 10,
    createdAt: `2026-08-0${id.slice(-1)}T00:00:00.000Z`,
    entries,
    ...extra,
  };
}

const RISE = [
  { timeSeconds: 60, stamp: 'stress', valence: -2, arousal: 5, comment: '序盤つらい' },
  { timeSeconds: 300, valence: 0, arousal: 3, comment: '慣れてきた' },
  { timeSeconds: 540, stamp: 'hype', valence: 2, arousal: 5, comment: 'ボス撃破' },
];

test('arc ids are stable per player and game and safe as path segments', () => {
  assert.equal(arcRecordId('tester', 'Elden Ring'), arcRecordId('tester', 'Elden Ring'));
  assert.notEqual(arcRecordId('tester', 'Elden Ring'), arcRecordId('other', 'Elden Ring'));
  assert.match(arcRecordId('tester', 'ゲーム/名 with spaces'), /^arc-[0-9a-f]{24}$/);
});

test('games lists the player\'s titles with session counts, ignoring other respondents', async () => {
  const service = new NarrativeArcService({
    emotionCurveStore: fakeStore([
      curve('c1', 'Elden Ring', RISE),
      curve('c2', 'Elden Ring ', RISE),
      curve('c3', 'Hades', RISE),
      curve('c4', 'Elden Ring', RISE, { respondent: { name: 'someone-else' } }),
      curve('c5', 'Elden Ring', RISE, { respondent: undefined }),
    ]),
    arcStore: fakeStore(),
    llmClient: { isConfigured: () => true, async generate() { throw new Error('unused'); } },
  });
  const games = await service.games(CONTEXT);
  assert.deepEqual(games.map((game) => [game.gameTitle, game.sessionCount]), [['Elden Ring', 2], ['Hades', 1]]);
});

test('analyze aggregates only the player\'s curves for that game and persists provenance', async () => {
  const arcStore = fakeStore();
  const service = new NarrativeArcService({
    emotionCurveStore: fakeStore([
      curve('c1', 'Elden Ring', RISE, { narrativeArc: '苦戦→達成' }),
      curve('c2', 'Elden Ring', RISE),
      curve('c3', 'Hades', RISE),
      curve('c4', 'Elden Ring', RISE, { respondent: { name: 'someone-else' } }),
      curve('c5', 'Elden Ring', RISE, { respondent: undefined }),
    ]),
    arcStore,
    llmClient: { isConfigured: () => true, async generate() { throw new Error('unused'); } },
    now: () => new Date('2026-08-16T00:00:00.000Z'),
  });
  await assert.rejects(service.analyze(CONTEXT, { gameTitle: '' }), /gameTitle is required/);
  await assert.rejects(
    service.analyze(CONTEXT, { gameTitle: 'Hades' }),
    (error) => error.code === 'NARRATIVE_ARC_INSUFFICIENT_SESSIONS'
  );
  const record = await service.analyze(CONTEXT, { gameTitle: ' Elden Ring ' });
  assert.equal(record.id, arcRecordId('tester', 'Elden Ring'));
  assert.equal(record.gameTitle, 'Elden Ring');
  assert.deepEqual(record.sourceRecordIds, ['c1', 'c2']);
  assert.equal(record.provenance.extractor, 'arc-aggregate/v1');
  assert.equal(record.provenance.analyzedAt, '2026-08-16T00:00:00.000Z');
  assert.equal(record.analysis.sessionCount, 2);
  assert.equal(record.analysis.shape.archetype, 'rags-to-riches');
  assert.equal(record.analysis.sessions[0].declaredArc, '苦戦→達成');
  assert.equal(record.evaluation, null);
  // Re-analysis overwrites the same derived record instead of adding one.
  await service.analyze(CONTEXT, { gameTitle: 'Elden Ring' });
  assert.equal(arcStore.records.size, 1);
  assert.equal((await service.find(CONTEXT, record.id)).id, record.id);
  await assert.rejects(service.find(CONTEXT, 'missing'), /not found/);
});

test('evaluate sends the aggregate plus source entries to the LLM and stores the commentary', async () => {
  const generated = [];
  const arcStore = fakeStore();
  const emotionCurveStore = fakeStore([
    curve('c1', 'Elden Ring', RISE),
    curve('c2', 'Elden Ring', RISE),
  ]);
  const service = new NarrativeArcService({
    emotionCurveStore,
    arcStore,
    llmClient: {
      isConfigured: () => true,
      async generate(input) {
        generated.push(input);
        return { text: '解説テキスト', model: 'test-model' };
      },
    },
    now: () => new Date('2026-08-16T00:00:00.000Z'),
  });
  const analyzed = await service.analyze(CONTEXT, { gameTitle: 'Elden Ring' });
  const evaluated = await service.evaluate(CONTEXT, analyzed.id);
  assert.equal(evaluated.evaluation.text, '解説テキスト');
  assert.equal(evaluated.evaluation.model, 'test-model');
  assert.equal(evaluated.evaluation.extractor, 'llm');
  assert.deepEqual(evaluated.evaluation.sourceRecordIds, ['c1', 'c2']);
  assert.equal(evaluated.evaluation.sourceRevision, evaluated.sourceRevision);
  assert.equal(generated[0].system, SYSTEM_PROMPT);
  assert.match(generated[0].prompt, /ゲーム: Elden Ring/);
  assert.match(generated[0].prompt, /ボス撃破/);
  assert.match(generated[0].prompt, /右肩上がり/);
  // Re-analysis after evaluation keeps the commentary.
  const reanalyzed = await service.analyze(CONTEXT, { gameTitle: 'Elden Ring' });
  assert.equal(reanalyzed.evaluation.text, '解説テキスト');
  assert.equal(reanalyzed.evaluation.sourceRevision, reanalyzed.sourceRevision);

  // Editing a curve in place keeps its id, but must still make the preserved
  // commentary detectably stale after re-analysis.
  emotionCurveStore.records.set('c1', curve('c1', 'Elden Ring', [
    ...RISE,
    { timeSeconds: 570, stamp: 'like', valence: 1, arousal: 3, comment: '編集で追加' },
  ], { editedAt: '2026-08-16T01:00:00.000Z' }));
  await assert.rejects(
    service.evaluate(CONTEXT, analyzed.id),
    (error) => error.code === 'NARRATIVE_ARC_STALE'
  );
  const afterEdit = await service.analyze(CONTEXT, { gameTitle: 'Elden Ring' });
  assert.equal(afterEdit.evaluation.text, '解説テキスト');
  assert.notEqual(afterEdit.evaluation.sourceRevision, afterEdit.sourceRevision);
});

test('the prompt is deterministic and marks missing declared arcs and gaps', () => {
  const analysis = {
    sessionCount: 2,
    shape: { label: '平坦 (起伏なし)', correlation: null, candidates: [] },
    peak: null,
    valley: null,
    ending: null,
    peakEnd: null,
    consistency: null,
    trend: { slope: null },
    bins: [{ valence: null, arousal: null }, { valence: 1.25, arousal: 3.5 }],
    sessions: [{
      sessionLabel: '', mode: 'memory', createdAt: null, daysAfterPlay: null,
      summary: { entryCount: 0, meanValence: null, meanArousal: null, peakPosition: null, stampCounts: {} },
      declaredArc: '', valence: [null, 1.25],
    }],
  };
  const first = buildNarrativeArcPrompt({ gameTitle: 'X', analysis, records: [] });
  const second = buildNarrativeArcPrompt({ gameTitle: 'X', analysis, records: [] });
  assert.equal(first, second);
  assert.match(first, /平均感情価の推移 \(0→100%\): － 1\.3/);
  assert.match(first, /セッション 1: 名称なし \(memory\)/);
  assert.match(first, /\(メモ・スタンプ付きの記録なし\)/);
  assert.match(first, /# 出力構成/);
});
