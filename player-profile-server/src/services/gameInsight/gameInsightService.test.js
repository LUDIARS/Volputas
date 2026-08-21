const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ProfileRecordStore } = require('../../local/profileRecordStore');
const { CohortReader } = require('./cohortReader');
const { GameInsightService, insightRecordId, sourceRevision } = require('./gameInsightService');

function curve(id, name, entries, extra = {}) {
  return {
    id, gameTitle: 'Hot Quest', mode: 'video', sessionPlaytimeMinutes: 10,
    respondent: { name }, createdAt: `2026-08-0${id.length % 9 + 1}T00:00:00.000Z`, entries, ...extra,
  };
}
const calm = (timeSeconds) => ({ timeSeconds, valence: 0.5, arousal: 2 });

async function seedRepository(root) {
  const store = new ProfileRecordStore('emotion-curves');
  await store.write({ repositoryRoot: root, name: 'me', data: curve('me-1', 'me', [calm(30), { timeSeconds: 300, valence: 2, arousal: 5, stamp: 'hype', comment: 'ボス' }, calm(570)], { captureSessionId: 'cap-1' }) });
  await store.write({ repositoryRoot: root, name: 'me', data: curve('imported-1', 'friend', [calm(30), { timeSeconds: 305, valence: 1.5, arousal: 5, stamp: 'hype' }, calm(570)]) });
  await store.write({ repositoryRoot: root, name: 'other', data: curve('other-1', 'other', [calm(30), { timeSeconds: 120, valence: -2, arousal: 4, stamp: 'stress' }], { sessionPlaytimeMinutes: 2.5 }) });
  await store.write({ repositoryRoot: root, name: 'other', data: { ...curve('other-2', 'other', [calm(10)]), gameTitle: 'Another Game' } });
}

test('game insight aggregates across every player directory and persists a derived record', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'volputas-game-insight-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await seedRepository(root);
  const context = { repositoryRoot: root, name: 'me' };
  const service = new GameInsightService({
    cohortReader: new CohortReader(),
    insightStore: new ProfileRecordStore('game-insights'),
    llmClient: { isConfigured: () => true, generate: async () => ({ text: 'x', model: 'm' }) },
    now: () => new Date('2026-08-20T00:00:00.000Z'),
  });

  const games = await service.games(context);
  assert.deepEqual(games.map((game) => [game.gameTitle, game.playerCount, game.sessionCount]),
    [['Hot Quest', 3, 3], ['Another Game', 1, 1]]);

  await assert.rejects(service.analyze(context, { gameTitle: 'Another Game' }),
    (error) => error.code === 'GAME_INSIGHT_INSUFFICIENT_SESSIONS');
  await assert.rejects(service.analyze(context, { gameTitle: '' }),
    (error) => error.code === 'INVALID_GAME_INSIGHT_INPUT');
  await assert.rejects(service.analyze(context, { gameTitle: 'x'.repeat(201) }),
    (error) => error.code === 'INVALID_GAME_INSIGHT_INPUT' && error.statusCode === 400);

  const record = await service.analyze(context, { gameTitle: ' Hot Quest ' });
  assert.equal(record.id, insightRecordId('Hot Quest'));
  assert.equal(record.gameTitle, 'Hot Quest');
  assert.deepEqual(record.sourceRecordIds, ['imported-1', 'me-1', 'other-1']);
  assert.equal(record.analysis.playerCount, 3);
  assert.equal(record.analysis.sessionCount, 3);
  assert.equal(record.provenance.extractor, 'hotspot-aggregate-ordinal/v2');
  assert.equal(record.analysis.scales, null, 'no voice reader → no scale aggregate');
  assert.ok(record.analysis.bins.some((bin) => Number.isFinite(bin.arousalZ)), 'bins carry within-player z');
  assert.equal(record.proposal, null);
  const onDisk = JSON.parse(await fs.readFile(path.join(root, 'game-insights', 'me', `${record.id}.json`), 'utf8'));
  assert.equal(onDisk.sourceRevision, record.sourceRevision);

  // Re-analysis overwrites instead of piling up.
  const again = await service.analyze(context, { gameTitle: 'Hot Quest' });
  assert.equal((await service.list(context)).length, 1);
  assert.equal(again.createdAt, record.createdAt);
});

test('propose joins capture markers, Anatomia locations and frames, and detects stale sources', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'volputas-game-insight-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await seedRepository(root);
  const context = { repositoryRoot: root, name: 'me' };
  const captureSession = {
    id: 'cap-1', gameTitle: 'Hot Quest', startedAt: '2026-08-01T00:00:00.000Z', status: 'completed',
    anchors: [{ sessionMs: 0, gameClockMs: 1000 }],
    markers: [{ sessionMs: 280000, origin: 'game', type: 'event', label: 'boss:GoblinKing' }],
    capture: { screenRecording: { startSessionMs: 0, durationSeconds: 600 } },
  };
  const otherCaptureSession = {
    ...captureSession,
    id: 'cap-other',
    gameTitle: 'Another Game',
  };
  const unlinkedLongCaptureSession = {
    ...captureSession,
    id: 'cap-unlinked-long',
    capture: { screenRecording: { startSessionMs: 0, durationSeconds: 1200 } },
  };
  const captureSessions = [captureSession, otherCaptureSession, unlinkedLongCaptureSession];
  const anatomiaCalls = [];
  const generated = [];
  const frameRequests = [];
  const service = new GameInsightService({
    cohortReader: new CohortReader(),
    insightStore: new ProfileRecordStore('game-insights'),
    captureSessionService: {
      list: async () => captureSessions,
      findRecord: async (_context, id) => {
        const found = captureSessions.find((session) => session.id === id);
        if (!found) throw Object.assign(new Error('nf'), { statusCode: 404 });
        return found;
      },
      resolveVideo: async () => ({ filePath: 'E:/videos/cap-1.webm', contentType: 'video/webm' }),
    },
    anatomiaClient: {
      isConfigured: () => true,
      context: async (project, task) => { anatomiaCalls.push(['context', project, task]); return { existingDomains: ['combat'], exemplars: [{ name: 'spawnBoss', filePath: 'E:/g/boss.ts', startLine: 1, endLine: 9, signature: 's' }] }; },
      findSymbol: async (project, symbol) => { anatomiaCalls.push(['find', project, symbol]); return symbol === 'GoblinKing' ? [{ name: 'GoblinKing', filePath: 'E:/g/goblin.ts', startLine: 3, endLine: 40, signature: 'class GoblinKing' }] : []; },
    },
    frameExtractor: {
      withFrames: async (videoPath, secondsList, use) => {
        frameRequests.push({ videoPath, secondsList });
        return use({ frames: secondsList.map((seconds, index) => ({ seconds, filePath: `C:/tmp/frame-${index}.jpg` })), skipped: [] });
      },
    },
    llmClient: {
      isConfigured: () => true,
      generate: async (input) => {
        generated.push(input);
        return { text: '改善提案\n## 西洋の判定 (機序)\n- 確度: 高\n## 東洋の判定 (全体観)\n- 確度: 低\n## 合議\n一致度: 低', model: 'test-model' };
      },
    },
    now: () => new Date('2026-08-20T00:00:00.000Z'),
  });
  const record = await service.analyze(context, { gameTitle: 'Hot Quest' });

  const configuredLlm = service.llmClient;
  service.llmClient = { isConfigured: () => false };
  await assert.rejects(
    service.propose(context, record.id, {}),
    (error) => error.code === 'LLM_NOT_CONFIGURED' && error.statusCode === 503
  );
  service.llmClient = configuredLlm;

  const candidates = await service.captureSessionCandidates(context, record.id);
  assert.deepEqual(candidates.map((candidate) => [candidate.id, candidate.linked, candidate.hasScreenRecording, candidate.gameMarkerCount]),
    [['cap-1', true, true, 1], ['cap-unlinked-long', false, true, 1]]);
  assert.equal(candidates[0].screenRecordingDurationSeconds, 600);

  const proposed = await service.propose(context, record.id, { anatomiaProject: 'hot-quest' });
  assert.match(proposed.proposal.text, /^改善提案/);
  assert.equal(proposed.proposal.schemaVersion, 2);
  assert.equal(proposed.proposal.judgments.complete, true);
  assert.equal(proposed.proposal.judgments.western.confidence, '高');
  assert.equal(proposed.proposal.judgments.eastern.confidence, '低');
  assert.equal(proposed.proposal.judgments.agreement, '低');
  assert.match(generated[0].prompt, /# 二流派の判定/);
  assert.equal(proposed.proposal.anatomiaProject, 'hot-quest');
  assert.equal(proposed.proposal.captureSessionId, 'cap-1');
  assert.ok(proposed.proposal.focusCount >= 1);
  assert.equal(proposed.proposal.frameCount, frameRequests[0].secondsList.length);
  assert.ok(proposed.proposal.codeLocationCount >= 1);
  assert.equal(proposed.proposal.sourceRevision, record.sourceRevision);
  assert.equal(Object.hasOwn(proposed.proposal, 'focusPoints'), false);
  assert.ok(anatomiaCalls.some(([kind, project]) => kind === 'context' && project === 'hot-quest'));
  assert.equal(frameRequests[0].videoPath, 'E:/videos/cap-1.webm');
  assert.equal(generated.length, 1);
  assert.ok(generated[0].imagePaths.length === frameRequests[0].secondsList.length);
  assert.match(generated[0].prompt, /Hot Quest/);
  assert.match(generated[0].prompt, /spawnBoss/);
  // The boss marker precedes the hype focus near 50%.
  assert.match(generated[0].prompt, /boss:GoblinKing/);
  assert.match(generated[0].prompt, /GoblinKing/);
  // A caller cannot attach a private recording from another game by bypassing
  // the UI's filtered capture-session list.
  await assert.rejects(
    service.propose(context, record.id, { captureSessionId: 'cap-other' }),
    (error) => error.code === 'CAPTURE_SESSION_GAME_MISMATCH' && error.statusCode === 400
  );

  // Proposal survives re-analysis and a source edit makes it stale.
  const reanalyzed = await service.analyze(context, { gameTitle: 'Hot Quest' });
  assert.equal(reanalyzed.proposal.text, proposed.proposal.text);
  const store = new ProfileRecordStore('emotion-curves');
  await store.write({ repositoryRoot: root, name: 'other', data: { ...(await new CohortReader().readGame(context, 'Hot Quest')).find((item) => item.record.id === 'other-1').record, entries: [calm(5)] } });
  await assert.rejects(service.propose(context, record.id, {}), (error) => error.code === 'GAME_INSIGHT_STALE');
  const refreshed = await service.analyze(context, { gameTitle: 'Hot Quest' });
  assert.notEqual(refreshed.sourceRevision, record.sourceRevision);
  assert.equal(refreshed.proposal.sourceRevision, record.sourceRevision);

  // Without Anatomia project and without frames the proposal still runs.
  const plainService = new GameInsightService({
    cohortReader: new CohortReader(),
    insightStore: new ProfileRecordStore('game-insights'),
    llmClient: { isConfigured: () => true, generate: async () => ({ text: 'plain', model: 'm' }) },
  });
  const plain = await plainService.propose(context, record.id, {});
  assert.equal(plain.proposal.frameCount, 0);
  assert.equal(plain.proposal.codeLocationCount, 0);
  assert.equal(plain.proposal.captureSessionId, null);
  await assert.rejects(plainService.propose(context, record.id, { captureSessionId: 'cap-1' }),
    (error) => error.code === 'CAPTURE_SESSION_NOT_CONFIGURED');
  await assert.rejects(plainService.propose(context, record.id, { anatomiaProject: 'x' }),
    (error) => error.code === 'ANATOMIA_NOT_CONFIGURED');
});

test('sourceRevision ignores record order but not entries', () => {
  const a = { playerKey: 'p', record: { id: 'a', entries: [calm(1)] } };
  const b = { playerKey: 'q', record: { id: 'b', entries: [calm(2)] } };
  assert.equal(sourceRevision([a, b]), sourceRevision([b, a]));
  assert.notEqual(sourceRevision([a, b]), sourceRevision([a, { ...b, record: { ...b.record, entries: [calm(3)] } }]));
  const duplicateId = { playerKey: 'z', record: { id: 'a', entries: [calm(4)] } };
  assert.equal(sourceRevision([a, duplicateId]), sourceRevision([duplicateId, a]));
});

test('sourceRevision covers the scale answers that feed analysis.scales', () => {
  const a = { playerKey: 'p', record: { id: 'a', entries: [calm(1)] } };
  const voice = (scales) => [{ playerKey: 'p', record: { id: 'v1', gameTitle: 'Hot Quest', scales } }];
  // A changed scale answer must invalidate the stored proposal.
  assert.notEqual(
    sourceRevision([a], voice({ geq: { flow_1: 1 } })),
    sourceRevision([a], voice({ geq: { flow_1: 4 } }))
  );
  // Voices without scales contribute nothing, so unrelated impressions do not
  // churn the revision.
  assert.equal(
    sourceRevision([a]),
    sourceRevision([a], [{ playerKey: 'p', record: { id: 'v2', gameTitle: 'X', comment: 'hi' } }])
  );
});

test('scales from every player impression are aggregated ordinal-first into analysis.scales', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'volputas-game-insight-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await seedRepository(root);
  const voices = new ProfileRecordStore('voices');
  const voice = (id, name, gameTitle, scales) => ({ id, gameTitle, comment: 'c', polarity: 'like', sentiment: 1, respondent: { name }, createdAt: '2026-08-01T00:00:00.000Z', scales });
  await voices.write({ repositoryRoot: root, name: 'me', data: voice('v1', 'me', 'Hot Quest', { geq: { flow_1: 4, flow_2: 4 } }) });
  await voices.write({ repositoryRoot: root, name: 'me', data: voice('v2', 'me', 'Another Game', { geq: { flow_1: 2, flow_2: 2 } }) });
  await voices.write({ repositoryRoot: root, name: 'other', data: voice('v3', 'other', 'Hot Quest', { pens: { autonomy: 6 } }) });
  const service = new GameInsightService({
    cohortReader: new CohortReader(),
    voiceCohortReader: new CohortReader({ collection: 'voices' }),
    insightStore: new ProfileRecordStore('game-insights'),
    llmClient: { isConfigured: () => false },
    now: () => new Date('2026-08-20T00:00:00.000Z'),
  });
  const record = await service.analyze({ repositoryRoot: root, name: 'me' }, { gameTitle: 'Hot Quest' });
  const { scales } = record.analysis;
  assert.equal(scales.playerCount, 2);
  assert.equal(scales.recordCount, 2);
  assert.equal(scales.families.geq.subscales.flow.raw, 4);
  assert.equal(scales.families.geq.subscales.flow.z, 1, 'Hot Quest is one sd above the usual of that recorder');
  assert.equal(scales.families.pens.subscales.autonomy.playerCount, 1);
});
