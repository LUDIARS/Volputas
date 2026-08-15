const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createLocalApp } = require('../localApp');

test('narrative arc routes list games, aggregate sessions and store LLM commentary', async (t) => {
  const repositoryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'volputas-narrative-arc-'));
  t.after(() => fs.rm(repositoryRoot, { recursive: true, force: true }));
  const config = { schemaVersion: 2, dataRepositoryPath: repositoryRoot, name: 'arc-tester' };
  const gitAuthor = {
    repositoryRoot,
    name: config.name,
    email: 'arc@example.test',
    remoteUrl: 'https://github.com/LUDIARS/VolputasData.git',
  };
  const prompts = [];
  const app = createLocalApp({
    serveFrontend: false,
    configStore: { read: async () => config, write: async (value) => value },
    gitAuthorReader: { read: async () => gitAuthor },
    llmClient: {
      isConfigured: () => true,
      async generate({ prompt }) {
        prompts.push(prompt);
        return { text: 'アーク解説', model: 'test-model' };
      },
    },
  });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  async function json(pathname, options) {
    const response = await fetch(`${origin}${pathname}`, options);
    const payload = await response.json();
    return { status: response.status, payload };
  }
  const post = (pathname, body) => json(pathname, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  const status = await json('/api/local/narrative-arcs/status');
  assert.equal(status.payload.data.evaluation.configured, true);

  assert.deepEqual((await json('/api/local/narrative-arcs/games')).payload.data, []);
  const insufficient = await post('/api/local/narrative-arcs/analyze', { gameTitle: 'Arc Quest' });
  assert.equal(insufficient.status, 409);
  assert.equal(insufficient.payload.error.code, 'NARRATIVE_ARC_INSUFFICIENT_SESSIONS');

  for (const label of ['初回', '2回目']) {
    const created = await post('/api/local/emotion-curves', {
      gameTitle: 'Arc Quest',
      mode: 'memory',
      sessionLabel: label,
      entries: [
        { position: 10, stamp: 'stress', comment: '最初は難しい' },
        { position: 55, stamp: 'like' },
        { position: 95, stamp: 'hype', comment: 'クリア' },
      ],
    });
    assert.equal(created.status, 201);
  }
  const games = await json('/api/local/narrative-arcs/games');
  assert.deepEqual(games.payload.data.map((game) => [game.gameTitle, game.sessionCount]), [['Arc Quest', 2]]);

  const wrongType = await json('/api/local/narrative-arcs/analyze', {
    method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'gameTitle=Arc Quest',
  });
  assert.equal(wrongType.status, 415);

  const analyzed = await post('/api/local/narrative-arcs/analyze', { gameTitle: 'Arc Quest' });
  assert.equal(analyzed.status, 201);
  const arc = analyzed.payload.data;
  assert.equal(arc.analysis.sessionCount, 2);
  assert.equal(arc.analysis.shape.archetype, 'rags-to-riches');
  assert.equal(arc.sourceRecordIds.length, 2);

  const listed = await json('/api/local/narrative-arcs');
  assert.equal(listed.payload.data.length, 1);
  assert.equal((await json(`/api/local/narrative-arcs/${arc.id}`)).payload.data.gameTitle, 'Arc Quest');
  assert.equal((await json('/api/local/narrative-arcs/unknown')).status, 404);

  const evaluateWrongType = await json(`/api/local/narrative-arcs/${arc.id}/evaluate`, {
    method: 'POST', headers: { 'content-type': 'text/plain' }, body: '',
  });
  assert.equal(evaluateWrongType.status, 415);

  const evaluated = await post(`/api/local/narrative-arcs/${arc.id}/evaluate`, {});
  assert.equal(evaluated.status, 200);
  assert.equal(evaluated.payload.data.evaluation.text, 'アーク解説');
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /クリア/);

  // The derived record lives in its own collection inside the data repository.
  const arcFiles = await fs.readdir(path.join(repositoryRoot, 'narrative-arcs', config.name));
  assert.deepEqual(arcFiles, [`${arc.id}.json`]);
});
