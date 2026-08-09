const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { GAME_LOG_EXCERPT_LIMIT } = require('./emotionCurveEvaluationPrompt');
const { createGlabEvidenceService } = require('./glabEvidenceService');

const OWNER = 'ba8e37c8-0f60-4f22-9c1a-6b0a7cbd7e01';
const GAME_ID = '3f1a2b4c-5d6e-4f70-8192-a3b4c5d6e7f8';

function emotionCurveBody(overrides = {}) {
  return {
    gameTitle: '手入力のゲーム名',
    mode: 'video',
    videoFileName: 'play.mp4',
    entries: [{ timeSeconds: 12, stamp: 'hype' }],
    ...overrides,
  };
}

function stubs(overrides = {}) {
  const created = [];
  const evidenceStore = {
    created,
    findForOwner: async () => ({ kind: 'emotion-curves', ownerId: OWNER, record: { id: 'r1' } }),
    listForOwner: async () => [{ id: 'r1' }],
    createForOwner: async (ownerId, kind, payload) => {
      created.push({ ownerId, kind, payload });
      return { id: 'r1', ...payload };
    },
    updateForOwner: async (_ownerId, _kind, recordId, patch) => ({ id: recordId, ...patch }),
    readAnalysisForOwner: async () => ({ axes: [] }),
    findMediaForOwner: async () => ({ kind: 'videos', recordId: 'r1' }),
    saveMediaForOwner: async () => ({}),
    ...overrides.evidenceStore,
  };
  const mediaStore = {
    saved: [],
    removed: [],
    save: async (context) => {
      mediaStore.saved.push(context);
      return { bytes: 10, contentType: context.contentType };
    },
    remove: async (context) => { mediaStore.removed.push(context); },
    resolve: async () => null,
    ...overrides.mediaStore,
  };
  return {
    evidenceStore,
    mediaStore,
    mediaRoot: '/media-root',
    emotionCurveEvaluator: { evaluate: async () => ({ summary: 'ok' }) },
    gameRepository: {
      findById: async () => ({ id: GAME_ID, title: 'Uni Quest', is_active: true }),
      ...overrides.gameRepository,
    },
    issueTicket: async (claims) => `ticket:${claims.userId}:${claims.kind}`,
  };
}

test('the record is stored under the Cernere owner id, not a local user id', async () => {
  const deps = stubs();
  const service = createGlabEvidenceService(deps);

  await service.createEmotionCurve(OWNER, emotionCurveBody());

  assert.equal(deps.evidenceStore.created[0].ownerId, OWNER);
  assert.equal(deps.evidenceStore.created[0].kind, 'emotion-curves');
});

test('GLAB views do not expose the internal Cernere owner id', async () => {
  const deps = stubs({
    evidenceStore: {
      listForOwner: async () => [{ id: 'r1', userId: OWNER, gameTitle: 'Uni Quest' }],
      createForOwner: async (_ownerId, _kind, payload) => ({
        id: 'r2',
        userId: OWNER,
        ...payload,
      }),
    },
  });
  const service = createGlabEvidenceService(deps);

  const [listed] = await service.listEmotionCurves(OWNER);
  const created = await service.createEmotionCurve(OWNER, emotionCurveBody());

  assert.equal(Object.hasOwn(listed, 'userId'), false);
  assert.equal(Object.hasOwn(created, 'userId'), false);
});

test('a registered game overrides the submitted title', async () => {
  const deps = stubs();
  const service = createGlabEvidenceService(deps);

  const record = await service.createEmotionCurve(OWNER, emotionCurveBody({ gameId: GAME_ID }));

  assert.equal(record.gameTitle, 'Uni Quest');
  assert.equal(record.gameId, GAME_ID);
});

test('a free-typed title survives when no game is selected', async () => {
  const service = createGlabEvidenceService(stubs());

  const record = await service.createEmotionCurve(OWNER, emotionCurveBody());

  assert.equal(record.gameTitle, '手入力のゲーム名');
  assert.equal(record.gameId, null);
});

test('an unknown or retired game is refused', async () => {
  const missing = createGlabEvidenceService(
    stubs({ gameRepository: { findById: async () => null } }),
  );
  await assert.rejects(
    () => missing.createEmotionCurve(OWNER, emotionCurveBody({ gameId: GAME_ID })),
    (error) => error.statusCode === 400 && error.code === 'GAME_NOT_FOUND',
  );

  const retired = createGlabEvidenceService(
    stubs({
      gameRepository: {
        findById: async () => ({ id: GAME_ID, title: 'Uni Quest', is_active: false }),
      },
    }),
  );
  await assert.rejects(
    () => retired.createEmotionCurve(OWNER, emotionCurveBody({ gameId: GAME_ID })),
    (error) => error.code === 'GAME_INACTIVE',
  );
});

test('a video cannot be attached to a record that does not accept it', async () => {
  const deps = stubs({
    evidenceStore: {
      findForOwner: async () => ({ kind: 'voices', ownerId: OWNER, record: { id: 'r1' } }),
    },
  });
  const service = createGlabEvidenceService(deps);

  await assert.rejects(
    () => service.saveMedia(OWNER, {
      kind: 'videos',
      recordId: 'r1',
      contentType: 'video/mp4',
      stream: Readable.from(['x']),
    }),
    (error) => error.statusCode === 404,
  );
  assert.equal(deps.mediaStore.saved.length, 0);
});

test('a file whose metadata write fails is not left behind', async () => {
  const deps = stubs({
    evidenceStore: {
      saveMediaForOwner: async () => {
        throw new Error('Cernere rejected the write');
      },
    },
  });
  const service = createGlabEvidenceService(deps);

  await assert.rejects(() => service.saveMedia(OWNER, {
    kind: 'videos',
    recordId: 'r1',
    contentType: 'video/mp4',
    stream: Readable.from(['x']),
  }));
  assert.equal(deps.mediaStore.removed.length, 1);
});

test('evaluation feeds the uploaded game log to the evaluator', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'glab-evidence-'));
  const logPath = path.join(directory, 'game.log');
  await fs.writeFile(logPath, 'boss defeated at 12:00', 'utf8');

  const seen = [];
  const deps = stubs({
    mediaStore: { resolve: async () => ({ filePath: logPath, contentType: 'text/plain' }) },
  });
  deps.emotionCurveEvaluator = {
    evaluate: async (input) => {
      seen.push(input);
      return { summary: 'ok' };
    },
  };
  const service = createGlabEvidenceService(deps);

  const record = await service.evaluateEmotionCurve(OWNER, 'r1');

  assert.equal(seen[0].gameLogText, 'boss defeated at 12:00');
  assert.deepEqual(record.evaluation, { summary: 'ok' });
  await fs.rm(directory, { recursive: true, force: true });
});

test('evaluation ignores an orphaned game-log file without owner-scoped metadata', async () => {
  const resolved = [];
  const seen = [];
  const deps = stubs({
    evidenceStore: { findMediaForOwner: async () => null },
    mediaStore: {
      resolve: async (context) => {
        resolved.push(context);
        return { filePath: 'orphan.log', contentType: 'text/plain' };
      },
    },
  });
  deps.emotionCurveEvaluator = {
    evaluate: async (input) => {
      seen.push(input);
      return { summary: 'ok' };
    },
  };

  await createGlabEvidenceService(deps).evaluateEmotionCurve(OWNER, 'r1');

  assert.equal(seen[0].gameLogText, null);
  assert.equal(resolved.length, 0);
});

test('evaluation reads at most the prompt game-log excerpt', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'glab-evidence-'));
  const logPath = path.join(directory, 'large.log');
  await fs.writeFile(logPath, 'x'.repeat(GAME_LOG_EXCERPT_LIMIT + 100), 'utf8');

  const seen = [];
  const deps = stubs({
    mediaStore: { resolve: async () => ({ filePath: logPath, contentType: 'text/plain' }) },
  });
  deps.emotionCurveEvaluator = {
    evaluate: async (input) => {
      seen.push(input);
      return { summary: 'ok' };
    },
  };

  await createGlabEvidenceService(deps).evaluateEmotionCurve(OWNER, 'r1');

  assert.equal(seen[0].gameLogText.length, GAME_LOG_EXCERPT_LIMIT);
  await fs.rm(directory, { recursive: true, force: true });
});

test('evaluating something that is not an emotion curve is a 404', async () => {
  const service = createGlabEvidenceService(stubs({
    evidenceStore: {
      findForOwner: async () => ({ kind: 'gameplay', ownerId: OWNER, record: { id: 'r1' } }),
    },
  }));

  await assert.rejects(
    () => service.evaluateEmotionCurve(OWNER, 'r1'),
    (error) => error.statusCode === 404,
  );
});

test('a ticket is only issued for media that actually exists', async () => {
  const service = createGlabEvidenceService(stubs({
    evidenceStore: { findMediaForOwner: async () => null },
  }));

  await assert.rejects(
    () => service.issueMediaTicket(OWNER, { kind: 'videos', recordId: 'r1' }),
    (error) => error.statusCode === 404 && error.code === 'MEDIA_NOT_FOUND',
  );
});
