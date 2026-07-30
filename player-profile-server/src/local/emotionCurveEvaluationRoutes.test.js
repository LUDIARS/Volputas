const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createLocalApp } = require('../localApp');

test('emotion curve routes accept stamps, game logs, and produce LLM evaluations', async (t) => {
  const repositoryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'volputas-emotion-eval-'));
  t.after(() => fs.rm(repositoryRoot, { recursive: true, force: true }));
  const config = {
    schemaVersion: 2,
    dataRepositoryPath: repositoryRoot,
    name: 'emotion-tester',
  };
  const gitAuthor = {
    repositoryRoot,
    name: config.name,
    email: 'emotion@example.test',
    remoteUrl: 'https://github.com/LUDIARS/VolputasData.git',
  };
  const evaluatorInputs = [];
  const app = createLocalApp({
    serveFrontend: false,
    configStore: {
      read: async () => config,
      write: async (value) => value,
    },
    gitAuthorReader: { read: async () => gitAuthor },
    emotionCurveEvaluator: {
      isConfigured: () => true,
      evaluate: async (input) => {
        evaluatorInputs.push(input);
        return {
          schemaVersion: 1,
          extractor: 'llm',
          model: 'test-model',
          text: 'テスト評価',
          evaluatedAt: '2026-07-27T12:00:00.000Z',
          personaAnalyzedAt: input.persona?.analyzedAt ?? null,
          usedGameLog: Boolean(input.gameLogText),
        };
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

  // Stamp-only entries need no comment; comment-less, stamp-less entries fail.
  const invalid = await json('/api/local/emotion-curves', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      gameTitle: 'Example Quest',
      videoFileName: 'play.mp4',
      entries: [{ timeSeconds: 5 }],
    }),
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.payload.error.code, 'INVALID_PROFILE_INPUT');

  const created = await json('/api/local/emotion-curves', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      gameTitle: 'Example Quest',
      videoFileName: 'play.mp4',
      gameLogFileName: 'session.log',
      totalPlaytimeHours: 12,
      sessionPlaytimeMinutes: 45,
      entries: [
        { timeSeconds: 30, stamp: 'hype' },
        { timeSeconds: 95, stamp: 'stress', comment: 'UI がわかりにくい' },
      ],
    }),
  });
  assert.equal(created.status, 201);
  const record = created.payload.data.record;
  assert.equal(record.totalPlaytimeHours, 12);
  assert.equal(record.sessionPlaytimeMinutes, 45);
  assert.deepEqual(
    record.entries.map((entry) => [entry.stamp, entry.valence, entry.arousal]),
    [['hype', 2, 5], ['stress', -2, 5]]
  );

  const logBytes = Buffer.from('boss_defeated t=95\n');
  const uploaded = await json(`/api/local/media/game-logs/${record.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'text/plain' },
    body: logBytes,
  });
  assert.equal(uploaded.status, 201);

  const evaluated = await json(`/api/local/emotion-curves/${record.id}/evaluate`, {
    method: 'POST',
  });
  assert.equal(evaluated.status, 200);
  assert.equal(evaluated.payload.data.evaluation.text, 'テスト評価');
  assert.equal(evaluated.payload.data.evaluation.usedGameLog, true);
  assert.equal(evaluatorInputs.length, 1);
  assert.equal(evaluatorInputs[0].gameLogText, 'boss_defeated t=95\n');
  assert.equal(evaluatorInputs[0].record.id, record.id);

  // The evaluation must be persisted on the stored record.
  const listed = await json('/api/local/emotion-curves');
  assert.equal(listed.payload.data[0].evaluation.text, 'テスト評価');

  const missing = await json('/api/local/emotion-curves/unknown-id/evaluate', {
    method: 'POST',
  });
  assert.equal(missing.status, 404);
});
