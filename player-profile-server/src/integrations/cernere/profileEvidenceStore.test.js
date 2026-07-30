const test = require('node:test');
const assert = require('node:assert/strict');
const { CernereProfileEvidenceStore } = require('./profileEvidenceStore');
const { OnlinePersonaService } = require('../../services/onlinePersonaService');

test('Cernere store keeps evidence, media metadata, and persona in managed-project columns', async () => {
  const columns = {
    annotation_records: null,
    card_sort_records: null,
    pitch_records: null,
    gameplay_records: null,
    voice_records: null,
    voicememo_records: null,
    emotion_curve_records: null,
    persona_analysis: null,
    profile_media: null,
  };
  const calls = [];
  const projectClient = {
    async request(module, action, payload) {
      calls.push({ module, action, payload });
      if (module === 'managed_project' && action === 'get_user_data') {
        return Object.fromEntries(payload.columns.map((column) => [column, columns[column]]));
      }
      if (module === 'managed_project' && action === 'set_user_data') {
        Object.assign(columns, payload.data);
        return { ok: true, updated: Object.keys(payload.data) };
      }
      if (module === 'volputas_survey' && action === 'get_response') return null;
      throw new Error(`Unexpected command: ${module}.${action}`);
    },
    close() {},
  };
  const timestamps = [
    new Date('2026-07-26T00:00:00.000Z'),
    new Date('2026-07-26T00:01:00.000Z'),
    new Date('2026-07-26T00:02:00.000Z'),
  ];
  const store = new CernereProfileEvidenceStore({
    projectClient,
    userResolver: { resolve: async () => '11111111-1111-4111-8111-111111111111' },
    surveyModel: { findActive: async () => [] },
    now: () => timestamps.shift() || new Date('2026-07-26T00:03:00.000Z'),
  });

  const gameplay = await store.create('local-user', 'gameplay', {
    gameTitle: 'Cernere Game',
    playtimeHours: 100,
    completionPercent: 80,
    selfRatedMastery: 4,
    dedication: { score: 82 },
  });
  assert.equal((await store.list('local-user', 'gameplay'))[0].id, gameplay.id);

  const voiceMemo = await store.create('local-user', 'voice-memos', {
    gameTitle: 'Cernere Game',
    audioFileName: 'memo.webm',
    transcript: 'ガチャは苦手',
    sentiment: -2,
    polarity: 'dislike',
    mechanicIds: ['core/gacha'],
  });
  assert.equal((await store.list('local-user', 'voice-memos'))[0].id, voiceMemo.id);
  const annotation = await store.create('local-user', 'annotations', {
    screenshotFileName: 'story.png',
    momentType: 'story',
    caption: 'The final reunion made the whole journey meaningful.',
  });
  assert.equal((await store.list('local-user', 'annotations'))[0].id, annotation.id);
  const cardSort = await store.create('local-user', 'card-sorts', {
    mechanicId: 'open-world/fast-travel',
    bucket: 'love',
  });
  assert.equal((await store.list('local-user', 'card-sorts'))[0].id, cardSort.id);
  const pitch = await store.create('local-user', 'pitches', {
    title: 'Changing Tower',
    body: 'ローグライクの塔を設計する。',
    referenceGames: '',
  });
  assert.equal((await store.list('local-user', 'pitches'))[0].id, pitch.id);

  const owned = await store.findOwned('local-user', gameplay.id);
  assert.equal(owned.kind, 'gameplay');
  assert.equal(owned.ownerId, '11111111-1111-4111-8111-111111111111');

  await store.saveMedia('local-user', {
    recordId: gameplay.id,
    kind: 'screenshots',
    contentType: 'image/png',
    bytes: 4,
  });
  const media = await store.findMedia('local-user', gameplay.id, 'screenshots');
  assert.match(media.storageKey, /screenshots/);

  const persona = new OnlinePersonaService(store, {
    steamModel: { getProfile: async () => null, getOwnedGames: async () => [] },
    now: () => new Date('2026-07-26T01:00:00.000Z'),
  });
  const first = await persona.analyze('local-user');
  assert.equal(first.recomputed, true);
  assert.equal(first.analysis.evidence.gameplay, 1);
  assert.equal(first.analysis.evidence.voiceMemos, 1);
  assert.deepEqual(first.analysis.mechanicReactions.find((item) =>
    item.mechanicId === 'core/gacha'), {
    mechanicId: 'core/gacha',
    sentiment: -2,
    samples: 1,
    sources: [`voicememo:${voiceMemo.id}`],
  });
  assert.equal(first.analysis.evidence.annotations, 1);
  assert.equal(first.analysis.evidence.cardSorts, 1);
  assert.equal(first.analysis.evidence.pitches, 1);
  // The annotation caption and the pitch body are both free-text affect samples.
  assert.equal(first.analysis.affect.sampleTexts, 2);
  assert.ok(
    first.analysis.preferenceAxes['style.narrative'].contributions
      .some((item) => item.source.kind === 'annotation')
  );
  assert.equal(first.analysis.preferenceAxes['style.explorer'].score, 1);
  assert.deepEqual(first.analysis.mechanicReactions.find((item) =>
    item.mechanicId === 'open-world/fast-travel'), {
    mechanicId: 'open-world/fast-travel',
    sentiment: 1,
    samples: 1,
    sources: [`cardsort:${cardSort.id}`],
  });
  assert.deepEqual(first.analysis.mechanicReactions.find((item) =>
    item.mechanicId === 'runner/procedural-track'), {
    mechanicId: 'runner/procedural-track',
    sentiment: 1,
    samples: 1,
    sources: [`pitch:${pitch.id}`],
  });
  const unchanged = await persona.analyze('local-user');
  assert.equal(unchanged.recomputed, false);

  assert.ok(calls.every((call) =>
    ['managed_project', 'volputas_survey'].includes(call.module)));
  assert.equal(columns.gameplay_records.length, 1);
  assert.equal(columns.voicememo_records.length, 1);
  assert.equal(columns.annotation_records.length, 1);
  assert.equal(columns.card_sort_records.length, 1);
  assert.equal(columns.pitch_records.length, 1);
  assert.equal(columns.profile_media.length, 1);
  assert.equal(columns.persona_analysis.sourceFingerprint.length, 64);
});
