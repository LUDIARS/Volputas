const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createLocalApp } = require('../localApp');

test('local voice follow-up: save, answer one question at a time, skip and resume', async (t) => {
  const repositoryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'voluptas-voice-follow-up-'));
  t.after(() => fs.rm(repositoryRoot, { recursive: true, force: true }));
  const config = { schemaVersion: 2, dataRepositoryPath: repositoryRoot, name: 'follow-up-tester' };
  const gitAuthor = {
    repositoryRoot,
    name: config.name,
    email: 'follow-up@example.test',
    remoteUrl: 'https://github.com/LUDIARS/VolputasData.git',
  };
  const app = createLocalApp({
    serveFrontend: false,
    configStore: { read: async () => config, write: async (value) => value },
    gitAuthorReader: { read: async () => gitAuthor },
    dataRepositoryVisibilityChecker: {
      assertPrivate: async () => ({ isPrivate: true, visibility: 'private' }),
    },
  });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  async function call(pathname, body) {
    const response = await fetch(`${origin}${pathname}`, body === undefined ? {} : {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, payload: await response.json() };
  }

  const created = await call('/api/local/voices', {
    gameTitle: 'Follow Up', comment: 'よかった', playProgress: 'cleared',
  });
  assert.equal(created.status, 201);
  const voice = created.payload.data.record;
  assert.equal(voice.sentiment, null);
  assert.equal(voice.playProgress, 'cleared');
  const followUp = `/api/local/voices/${voice.id}/follow-up`;

  assert.equal((await call(followUp)).payload.data.question.id, 'sentiment');
  const answered = await call(followUp, { questionId: 'sentiment', answer: '-1' });
  assert.equal(answered.status, 200);
  assert.equal(answered.payload.data.record.sentiment, -1);
  assert.equal(answered.payload.data.record.comment, 'よかった');

  const skipped = await call(followUp, { questionId: 'polarity', skip: true });
  assert.equal(skipped.payload.data.question.id, 'reason');

  // Resume later: the stored record remembers both the answer and the skip.
  const resumed = await call(followUp);
  assert.equal(resumed.payload.data.question.id, 'reason');
  const stored = (await call('/api/local/voices')).payload.data.find((item) => item.id === voice.id);
  assert.deepEqual(stored.skippedFollowUps, ['polarity']);
  assert.equal(stored.followUps.length, 1);

  assert.equal((await call(followUp, { questionId: 'sentiment', answer: '1' })).status, 409);
  assert.equal((await call('/api/local/voices/missing/follow-up')).status, 404);
});
