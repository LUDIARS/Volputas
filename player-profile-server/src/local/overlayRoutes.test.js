const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createLocalApp } = require('../localApp');

async function withOverlayApp(t, { captureSession = null, prepare } = {}) {
  const repositoryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'volputas-overlay-routes-'));
  t.after(() => fs.rm(repositoryRoot, { recursive: true, force: true }));
  await fs.mkdir(path.join(repositoryRoot, 'overlay-docs'), { recursive: true });
  await fs.writeFile(
    path.join(repositoryRoot, 'overlay-docs', 'checklist.md'),
    '# チェック\n\n```chart\n{ "type": "hotspot" }\n```\n',
    'utf8'
  );
  await fs.writeFile(path.join(repositoryRoot, 'overlay-docs', 'notes.txt'), 'ignored', 'utf8');
  if (prepare) await prepare({ repositoryRoot, documentsRoot: path.join(repositoryRoot, 'overlay-docs') });

  const config = { schemaVersion: 2, dataRepositoryPath: repositoryRoot, name: 'overlay-tester' };
  const app = createLocalApp({
    serveFrontend: false,
    configStore: { read: async () => config, write: async (value) => value },
    gitAuthorReader: {
      read: async () => ({
        repositoryRoot,
        name: config.name,
        email: 'overlay@example.test',
        remoteUrl: 'https://github.com/LUDIARS/VolputasData.git',
      }),
    },
    captureSessionService: { active: async () => captureSession },
    emotionCurveEvaluator: { evaluate: async () => ({}) },
    gameInsightService: {
      find: async (_context, id) => {
        if (id !== 'insight-1') {
          throw Object.assign(new Error('Game insight not found'), {
            statusCode: 404,
            code: 'GAME_INSIGHT_NOT_FOUND',
          });
        }
        return { id, gameTitle: 'Hot Quest', analysis: { bins: [] } };
      },
    },
    narrativeArcService: {
      find: async (_context, id) => ({ id, gameTitle: 'Hot Quest', analysis: { beats: [] } }),
    },
  });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return async function json(pathname) {
    const response = await fetch(`${origin}${pathname}`);
    return { status: response.status, payload: await response.json() };
  };
}

test('overlay status omits local paths and reports the absent capture session', async (t) => {
  const json = await withOverlayApp(t);
  const status = await json('/api/local/overlay/status');
  assert.equal(status.status, 200);
  assert.equal(status.payload.data.captureSession, null);
  assert.equal('markdownDirectory' in status.payload.data, false);
  assert.deepEqual(status.payload.data.chartKinds, ['hotspot', 'narrative-arc']);
});

test('overlay status carries the recording session so the overlay can time markers', async (t) => {
  const json = await withOverlayApp(t, {
    captureSession: { id: 'session-1', status: 'recording', startedAt: '2026-08-21T00:00:00.000Z' },
  });
  const status = await json('/api/local/overlay/status');
  assert.deepEqual(status.payload.data.captureSession, {
    id: 'session-1',
    status: 'recording',
    startedAt: '2026-08-21T00:00:00.000Z',
  });
});

test('overlay markdown lists only .md documents and serves their content', async (t) => {
  const json = await withOverlayApp(t);
  const list = await json('/api/local/overlay/markdown');
  assert.deepEqual(list.payload.data.map((item) => item.id), ['checklist.md']);
  const document = await json('/api/local/overlay/markdown/checklist.md');
  assert.equal(document.status, 200);
  assert.match(document.payload.data.markdown, /```chart/);
});

test('overlay markdown refuses traversal and reports a missing document', async (t) => {
  const json = await withOverlayApp(t);
  const traversal = await json('/api/local/overlay/markdown/%2E%2E%2Fpackage.json');
  assert.equal(traversal.status, 400);
  assert.equal(traversal.payload.error.code, 'INVALID_OVERLAY_DOCUMENT');
  const missing = await json('/api/local/overlay/markdown/absent.md');
  assert.equal(missing.status, 404);
  assert.equal(missing.payload.error.code, 'OVERLAY_DOCUMENT_NOT_FOUND');
});

test('overlay markdown refuses a symlink that escapes the document root', async (t) => {
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'volputas-overlay-outside-'));
  t.after(() => fs.rm(outsideRoot, { recursive: true, force: true }));
  const outsideFile = path.join(outsideRoot, 'private.md');
  await fs.writeFile(outsideFile, 'must not be served', 'utf8');
  let symlinkCreated = false;
  const json = await withOverlayApp(t, {
    prepare: async ({ documentsRoot }) => {
      try {
        await fs.symlink(outsideFile, path.join(documentsRoot, 'external.md'), 'file');
        symlinkCreated = true;
      } catch (error) {
        if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error;
      }
    },
  });
  if (!symlinkCreated) {
    t.skip('file symlinks are unavailable on this platform');
    return;
  }
  const response = await json('/api/local/overlay/markdown/external.md');
  assert.equal(response.status, 404);
  assert.equal(response.payload.error.code, 'OVERLAY_DOCUMENT_NOT_FOUND');
});

test('overlay charts pass the analysis through and reject an unknown kind', async (t) => {
  const json = await withOverlayApp(t);
  const hotspot = await json('/api/local/overlay/charts/hotspot/insight-1');
  assert.equal(hotspot.status, 200);
  assert.deepEqual(hotspot.payload.data, {
    type: 'hotspot',
    id: 'insight-1',
    gameTitle: 'Hot Quest',
    analysis: { bins: [] },
  });
  const arc = await json('/api/local/overlay/charts/narrative-arc/arc-1');
  assert.deepEqual(arc.payload.data.analysis, { beats: [] });
  const unknown = await json('/api/local/overlay/charts/radar/whatever');
  assert.equal(unknown.status, 400);
  assert.equal(unknown.payload.error.code, 'UNKNOWN_OVERLAY_CHART');
  const missing = await json('/api/local/overlay/charts/hotspot/absent');
  assert.equal(missing.status, 404);
});
