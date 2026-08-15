const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { GazeSampleLog } = require('./gazeSampleLog');

async function temporaryContext(t) {
  const repositoryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'volputas-gaze-'));
  t.after(() => fs.rm(repositoryRoot, { recursive: true, force: true }));
  return { repositoryRoot, name: 'tester', sessionId: 'session-1' };
}

test('appended batches read back in order across calls', async (t) => {
  const log = new GazeSampleLog();
  const context = await temporaryContext(t);
  await log.append(context, [{ sessionMs: 0, x: 0.1, y: 0.2, valid: true }]);
  await log.append(context, [{ sessionMs: 100, x: 0.3, y: 0.4, valid: false }]);
  assert.deepEqual(await log.read(context), [
    { sessionMs: 0, x: 0.1, y: 0.2, valid: true },
    { sessionMs: 100, x: 0.3, y: 0.4, valid: false },
  ]);
});

test('a session without samples reads as empty', async (t) => {
  const log = new GazeSampleLog();
  assert.deepEqual(await log.read(await temporaryContext(t)), []);
});

test('a path-escaping session id is rejected', async (t) => {
  const log = new GazeSampleLog();
  const context = { ...(await temporaryContext(t)), sessionId: '..' };
  await assert.rejects(
    log.append(context, [{ sessionMs: 0, x: 0, y: 0, valid: true }]),
    /escapes the data repository|cannot be used in a data path/
  );
});

test('an empty replacement is rejected without erasing the existing log', async (t) => {
  const log = new GazeSampleLog();
  const context = await temporaryContext(t);
  const original = { sessionMs: 0, x: 0.1, y: 0.2, valid: true };
  await log.append(context, [original]);
  await assert.rejects(
    log.replace(context, []),
    (error) => error.code === 'INVALID_CAPTURE_INPUT'
  );
  assert.deepEqual(await log.read(context), [original]);
});
