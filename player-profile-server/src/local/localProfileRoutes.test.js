const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createLocalApp } = require('../localApp');

test('local profile routes persist evidence, stream media, and cache persona analysis', async (t) => {
  const repositoryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'volputas-profile-routes-'));
  t.after(() => fs.rm(repositoryRoot, { recursive: true, force: true }));
  const config = {
    schemaVersion: 2,
    dataRepositoryPath: repositoryRoot,
    name: 'profile-tester',
  };
  const gitAuthor = {
    repositoryRoot,
    name: config.name,
    email: 'profile@example.test',
    remoteUrl: 'https://github.com/LUDIARS/VolputasData.git',
  };
  const app = createLocalApp({
    serveFrontend: false,
    configStore: {
      read: async () => config,
      write: async (value) => value,
    },
    gitAuthorReader: { read: async () => gitAuthor },
  });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  async function json(pathname, options) {
    const response = await fetch(`${origin}${pathname}`, options);
    const payload = await response.json();
    assert.equal(payload.ok, true, payload.error?.message);
    return payload.data;
  }

  const gameplay = await json('/api/local/gameplay', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      gameTitle: 'Route Test',
      playtimeHours: 50,
      completionPercent: 60,
      selfRatedMastery: 4,
      screenshotFileName: 'evidence.png',
    }),
  });
  assert.equal(gameplay.record.respondent.name, config.name);
  assert.equal(gameplay.record.dedication.confidence, 'high');

  const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  await json(`/api/local/media/screenshots/${gameplay.record.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'image/png' },
    body: imageBytes,
  });
  const downloadedImage = await fetch(
    `${origin}/api/local/media/screenshots/${gameplay.record.id}`
  );
  assert.equal(downloadedImage.status, 200);
  assert.deepEqual(Buffer.from(await downloadedImage.arrayBuffer()), imageBytes);

  await json('/api/local/voices', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      gameTitle: 'Route Test',
      scopeType: 'content',
      contentName: 'Final chapter',
      sentiment: 2,
      comment: 'The story conclusion was memorable.',
      tags: 'story',
    }),
  });
  const emotionCurve = await json('/api/local/emotion-curves', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      gameTitle: 'Route Test',
      videoFileName: 'session.mp4',
      narrativeArc: 'resolution',
      journeyStage: 'mastery',
      entries: [
        { timeSeconds: 12.5, valence: 2, arousal: 5, comment: 'The plan worked.' },
      ],
    }),
  });
  await json(`/api/local/media/videos/${emotionCurve.record.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'video/mp4' },
    body: Buffer.from('test-video'),
  });

  const before = await json('/api/local/persona');
  assert.equal(before.evidenceCount, 3);
  assert.equal(before.stale, true);

  const firstAnalysis = await json('/api/local/persona/analyze', { method: 'POST' });
  assert.equal(firstAnalysis.recomputed, true);
  assert.deepEqual(firstAnalysis.analysis.evidence, {
    surveys: 0,
    surveyDefinitions: 0,
    steam: 0,
    comparisons: 0,
    gameplay: 1,
    voices: 1,
    emotionCurves: 1,
  });

  const unchangedAnalysis = await json('/api/local/persona/analyze', { method: 'POST' });
  assert.equal(unchangedAnalysis.recomputed, false);
  assert.equal(
    unchangedAnalysis.analysis.sourceFingerprint,
    firstAnalysis.analysis.sourceFingerprint
  );
});
