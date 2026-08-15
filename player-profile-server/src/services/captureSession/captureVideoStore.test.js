const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { CaptureVideoStore, VIDEO_KINDS, assertVideoKind } = require('./captureVideoStore');

async function temporaryRepository(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'capture-video-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('video kinds map to their own media directories and unknown kinds are rejected', () => {
  assert.equal(assertVideoKind('screen'), VIDEO_KINDS.screen);
  assert.equal(assertVideoKind('face'), VIDEO_KINDS.face);
  assert.throws(() => assertVideoKind('audio'), /Unknown capture video kind/);
});

test('screen and face recordings are stored per session and resolved by kind', async (t) => {
  const repositoryRoot = await temporaryRepository(t);
  const store = new CaptureVideoStore();
  const context = { repositoryRoot, name: 'tester', sessionId: 'session-1' };

  const saved = await store.save({
    ...context, kind: 'screen', contentType: 'video/webm', stream: Readable.from(['abc']),
  });
  assert.equal(saved.fileName, 'session-1.webm');
  assert.equal(saved.bytes, 3);
  assert.equal(saved.kind, 'screen');
  assert.match(saved.filePath, /media[\\/]tester[\\/]capture-screen[\\/]session-1\.webm$/);

  assert.equal(await store.resolve({ ...context, kind: 'face' }), null);
  const resolved = await store.resolve({ ...context, kind: 'screen' });
  assert.equal(resolved.contentType, 'video/webm');
});

test('re-uploading in another container replaces the previous file', async (t) => {
  const repositoryRoot = await temporaryRepository(t);
  const store = new CaptureVideoStore();
  const context = { repositoryRoot, name: 'tester', sessionId: 'session-2', kind: 'screen' };
  await store.save({ ...context, contentType: 'video/webm', stream: Readable.from(['old']) });
  await store.save({ ...context, contentType: 'video/mp4', stream: Readable.from(['new!']) });
  const resolved = await store.resolve(context);
  assert.equal(resolved.contentType, 'video/mp4');
  await assert.rejects(fs.access(path.join(path.dirname(resolved.filePath), 'session-2.webm')));
});

test('unsupported video types and unsafe session ids are refused before writing', async (t) => {
  const repositoryRoot = await temporaryRepository(t);
  const store = new CaptureVideoStore();
  await assert.rejects(
    store.save({
      repositoryRoot, name: 'tester', sessionId: 'session-3', kind: 'face',
      contentType: 'image/gif', stream: Readable.from(['x']),
    }),
    (error) => error.code === 'UNSUPPORTED_MEDIA_TYPE'
  );
  await assert.rejects(
    store.save({
      repositoryRoot, name: 'tester', sessionId: '../escape', kind: 'face',
      contentType: 'video/webm', stream: Readable.from(['x']),
    }),
    (error) => error.code === 'INVALID_PROFILE_PATH'
  );
  await assert.rejects(
    store.save({
      repositoryRoot, name: 'tester', sessionId: 'session-3', kind: 'face',
      contentType: 'video/webm', stream: Readable.from([]),
    }),
    (error) => error.code === 'EMPTY_MEDIA_FILE'
  );
});
