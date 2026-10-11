const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ProfileRecordStore } = require('./profileRecordStore');

test('point reads isolate owners, reject path traversal and do not scan unrelated records', async (t) => {
  const repositoryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-analysis-store-'));
  t.after(() => fs.rm(repositoryRoot, { recursive: true, force: true }));
  const store = new ProfileRecordStore('voice-analyses');
  const context = { repositoryRoot, name: 'owner' };
  await store.write({ ...context, data: { id: 'v1', analysis: { sourceRevision: 'abc' } } });
  await fs.writeFile(path.join(repositoryRoot, 'voice-analyses', 'owner', 'broken.json'), '{', 'utf8');
  assert.equal((await store.read({ ...context, id: 'v1' })).analysis.sourceRevision, 'abc');
  assert.equal(await store.read({ ...context, name: 'other', id: 'v1' }), null);
  assert.equal(await store.read({ ...context, id: 'missing' }), null);
  await assert.rejects(store.read({ ...context, id: '../v1' }), { code: 'INVALID_PROFILE_PATH' });
  await assert.rejects(store.read({ ...context, id: 'broken' }), { code: 'INVALID_PROFILE_RECORD' });
});
