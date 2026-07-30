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
  await json('/api/local/voice-memos', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      gameTitle: 'Route Test',
      audioFileName: 'pending.webm',
      durationSeconds: 4,
      transcript: '',
    }),
  });
  const voiceMemo = await json('/api/local/voice-memos', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      gameTitle: 'Route Test',
      audioFileName: 'memo.webm',
      durationSeconds: 8,
      transcript: 'ガチャが苦手だった。',
      sentiment: -2,
      polarity: 'dislike',
      mechanicIds: ['core/gacha'],
    }),
  });
  const audioBytes = Buffer.from('test-audio');
  await json(`/api/local/media/voice-memos/${voiceMemo.record.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'audio/webm' },
    body: audioBytes,
  });
  const downloadedAudio = await fetch(
    `${origin}/api/local/media/voice-memos/${voiceMemo.record.id}`
  );
  assert.equal(downloadedAudio.status, 200);
  assert.deepEqual(Buffer.from(await downloadedAudio.arrayBuffer()), audioBytes);

  const pitch = await json('/api/local/pitches', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'Endless Citadel',
      body: 'ローグライクの塔を自由な発想で攻略する。',
      referenceGames: 'Hades',
    }),
  });
  assert.equal(pitch.record.title, 'Endless Citadel');
  const annotation = await json('/api/local/annotations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      screenshotFileName: 'discovery.png',
      momentType: 'discovery',
      caption: 'A hidden route opened behind the waterfall.',
    }),
  });
  await json(`/api/local/media/screenshots/${annotation.record.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'image/png' },
    body: imageBytes,
  });
  const downloadedAnnotation = await fetch(
    `${origin}/api/local/media/screenshots/${annotation.record.id}`
  );
  assert.equal(downloadedAnnotation.status, 200);
  assert.deepEqual(Buffer.from(await downloadedAnnotation.arrayBuffer()), imageBytes);

  await json('/api/local/card-sorts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mechanicId: 'action/dodge-roll',
      bucket: 'avoid',
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
  // gameplay + voice + emotion curve + card sort + annotation + pitch + the one
  // transcribed voice memo (the untranscribed memo does not count as evidence).
  assert.equal(before.evidenceCount, 7);
  assert.equal(before.stale, true);

  const firstAnalysis = await json('/api/local/persona/analyze', { method: 'POST' });
  assert.equal(firstAnalysis.recomputed, true);
  assert.deepEqual(firstAnalysis.analysis.evidence, {
    surveys: 0,
    surveyDefinitions: 0,
    steam: 0,
    comparisons: 0,
    annotations: 1,
    cardSorts: 1,
    pitches: 1,
    gameplay: 1,
    voices: 1,
    voiceMemos: 1,
    emotionCurves: 1,
  });
  assert.deepEqual(firstAnalysis.analysis.mechanicReactions.find((item) =>
    item.mechanicId === 'core/gacha'), {
    mechanicId: 'core/gacha',
    sentiment: -2,
    samples: 1,
    sources: [`voicememo:${voiceMemo.record.id}`],
  });
  // The annotation caption and the pitch body are both free-text affect samples.
  assert.equal(firstAnalysis.analysis.affect.sampleTexts, 2);
  assert.ok(
    firstAnalysis.analysis.preferenceAxes['style.explorer'].contributions
      .some((item) => item.source.kind === 'annotation')
  );
  assert.ok(firstAnalysis.analysis.aversions.some((item) =>
    item.target === 'mechanic:action/dodge-roll' && item.strength === 0.7));
  const cardSortReaction = firstAnalysis.analysis.mechanicReactions.find((item) =>
    item.mechanicId === 'action/dodge-roll');
  assert.equal(cardSortReaction.sentiment, -1);
  assert.equal(cardSortReaction.samples, 1);
  assert.equal(cardSortReaction.sources.length, 1);
  assert.match(cardSortReaction.sources[0], /^cardsort:/);
  const pitchReaction = firstAnalysis.analysis.mechanicReactions.find((item) =>
    item.mechanicId === 'runner/procedural-track');
  assert.deepEqual(pitchReaction, {
    mechanicId: 'runner/procedural-track',
    sentiment: 1,
    samples: 1,
    sources: [`pitch:${pitch.record.id}`],
  });
  assert.ok(firstAnalysis.analysis.preferenceAxes['mtg.johnny'].contributions.some((item) =>
    item.source.kind === 'pitch' && item.value === 0.6));
  assert.ok(firstAnalysis.analysis.preferenceAxes['style.autonomy'].contributions.some((item) =>
    item.source.kind === 'pitch' && item.value === 0.6));

  const unchangedAnalysis = await json('/api/local/persona/analyze', { method: 'POST' });
  assert.equal(unchangedAnalysis.recomputed, false);
  assert.equal(
    unchangedAnalysis.analysis.sourceFingerprint,
    firstAnalysis.analysis.sourceFingerprint
  );
});
