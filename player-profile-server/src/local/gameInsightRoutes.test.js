const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createLocalApp } = require('../localApp');
const { ProfileRecordStore } = require('./profileRecordStore');

test('game insight routes list games, aggregate across players and store the LLM proposal', async (t) => {
  const repositoryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'volputas-game-insight-routes-'));
  t.after(() => fs.rm(repositoryRoot, { recursive: true, force: true }));
  const config = { schemaVersion: 2, dataRepositoryPath: repositoryRoot, name: 'insight-tester' };
  const gitAuthor = {
    repositoryRoot,
    name: config.name,
    email: 'insight@example.test',
    remoteUrl: 'https://github.com/LUDIARS/VolputasData.git',
  };
  const prompts = [];
  const app = createLocalApp({
    serveFrontend: false,
    configStore: { read: async () => config, write: async (value) => value },
    gitAuthorReader: { read: async () => gitAuthor },
    llmClient: {
      isConfigured: () => true,
      async generate({ prompt, imagePaths }) {
        prompts.push({ prompt, imagePaths });
        return { text: '改善ポイント', model: 'test-model' };
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

  const status = await json('/api/local/game-insights/status');
  assert.equal(status.payload.data.evaluation.configured, true);
  assert.equal(typeof status.payload.data.anatomia.configured, 'boolean');

  assert.deepEqual((await json('/api/local/game-insights/games')).payload.data, []);
  const insufficient = await post('/api/local/game-insights/analyze', { gameTitle: 'Hot Quest' });
  assert.equal(insufficient.status, 409);
  assert.equal(insufficient.payload.error.code, 'GAME_INSIGHT_INSUFFICIENT_SESSIONS');

  // Own curve through the regular API …
  const created = await post('/api/local/emotion-curves', {
    gameTitle: 'Hot Quest',
    mode: 'video',
    videoFileName: 'run.mp4',
    sessionPlaytimeMinutes: 10,
    entries: [
      { timeSeconds: 30, stamp: 'like' },
      { timeSeconds: 300, stamp: 'hype', comment: 'ボス戦が熱い' },
      { timeSeconds: 570, stamp: 'like' },
    ],
  });
  assert.equal(created.status, 201);
  // … and another player's curve dropped into their own directory (imported data).
  const store = new ProfileRecordStore('emotion-curves');
  await store.write({
    repositoryRoot,
    name: 'friend',
    data: {
      id: 'friend-1', gameTitle: 'Hot Quest', mode: 'video', sessionPlaytimeMinutes: 2.5,
      respondent: { name: 'friend' },
      entries: [{ timeSeconds: 20, valence: 0, arousal: 2, comment: 'ふつう' }, { timeSeconds: 120, valence: -2, arousal: 4, stamp: 'stress', comment: '操作が分からない' }],
    },
  });

  const games = await json('/api/local/game-insights/games');
  assert.deepEqual(games.payload.data.map((game) => [game.gameTitle, game.playerCount, game.sessionCount]), [['Hot Quest', 2, 2]]);

  const wrongType = await json('/api/local/game-insights/analyze', {
    method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'gameTitle=Hot Quest',
  });
  assert.equal(wrongType.status, 415);

  const analyzed = await post('/api/local/game-insights/analyze', { gameTitle: 'Hot Quest' });
  assert.equal(analyzed.status, 201);
  const insight = analyzed.payload.data;
  assert.equal(insight.analysis.playerCount, 2);
  assert.equal(insight.analysis.sessionCount, 2);
  assert.equal(insight.analysis.referenceLengthSeconds, 600);
  assert.equal(insight.analysis.dropouts.length, 1);
  assert.equal(insight.analysis.dropouts[0].sessionCount, 1);
  assert.ok(insight.analysis.bins.length === 20);

  const listed = await json('/api/local/game-insights');
  assert.equal(listed.payload.data.length, 1);
  const fetched = await json(`/api/local/game-insights/${insight.id}`);
  assert.equal(fetched.payload.data.gameTitle, 'Hot Quest');
  assert.equal((await json('/api/local/game-insights/missing')).status, 404);

  const candidates = await json(`/api/local/game-insights/${insight.id}/capture-sessions`);
  assert.deepEqual(candidates.payload.data, []);

  const proposed = await post(`/api/local/game-insights/${insight.id}/propose`, {});
  assert.equal(proposed.status, 200, JSON.stringify(proposed.payload));
  assert.equal(proposed.payload.data.proposal.text, '改善ポイント');
  assert.equal(proposed.payload.data.proposal.model, 'test-model');
  assert.equal(proposed.payload.data.proposal.frameCount, 0);
  assert.equal(prompts.length, 1);
  assert.match(prompts[0].prompt, /ボス戦が熱い|操作が分からない/);
  assert.deepEqual(prompts[0].imagePaths, []);

  const invalidProject = await post(`/api/local/game-insights/${insight.id}/propose`, { anatomiaProject: 'bad name' });
  assert.ok([400, 503].includes(invalidProject.status));

  const stored = JSON.parse(await fs.readFile(
    path.join(repositoryRoot, 'game-insights', config.name, `${insight.id}.json`), 'utf8'
  ));
  assert.equal(stored.proposal.text, '改善ポイント');
  assert.equal(stored.provenance.extractor, 'hotspot-aggregate/v1');
});
