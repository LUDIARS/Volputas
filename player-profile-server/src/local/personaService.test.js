const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { PersonaService, fingerprintSources } = require('./personaService');
const { createEvidenceStores } = require('./createEvidenceStores');

test('source fingerprint is stable across object key order', () => {
  assert.equal(
    fingerprintSources({ voices: [{ id: 'one', comment: 'text' }], gameplay: [] }),
    fingerprintSources({ gameplay: [], voices: [{ comment: 'text', id: 'one' }] })
  );
});

test('persona analysis is reused until a source record changes', async (t) => {
  const repositoryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'volputas-persona-'));
  t.after(() => fs.rm(repositoryRoot, { recursive: true, force: true }));
  const timestamps = [
    new Date('2026-07-26T00:00:00.000Z'),
    new Date('2026-07-26T00:01:00.000Z'),
    new Date('2026-07-26T00:02:00.000Z'),
  ];
  const now = () => timestamps.shift() || new Date('2026-07-26T00:03:00.000Z');
  const evidenceStores = createEvidenceStores(now);
  const gameplayStore = evidenceStores.gameplay;
  const voiceStore = evidenceStores.voices;
  const service = new PersonaService({ evidenceStores, now });
  const context = { repositoryRoot, name: 'tester' };

  await gameplayStore.write({
    ...context,
    data: {
      id: 'game-one',
      gameTitle: 'Example',
      playtimeHours: 120,
      completionPercent: 80,
      selfRatedMastery: 5,
      dedication: { score: 90 },
    },
  });

  const first = await service.analyze(context);
  assert.equal(first.recomputed, true);
  assert.equal(first.analysis.evidence.gameplay, 1);
  assert.equal(first.analysis.axes.mastery.score, 90);

  const unchanged = await service.analyze(context);
  assert.equal(unchanged.recomputed, false);
  assert.equal(unchanged.analysis.analyzedAt, first.analysis.analyzedAt);

  await voiceStore.write({
    ...context,
    data: {
      id: 'voice-one',
      gameTitle: 'Example',
      scopeType: 'game',
      sentiment: 2,
      comment: 'The story and characters stayed with me.',
      tags: ['story'],
    },
  });
  const status = await service.status(context);
  assert.equal(status.stale, true);

  const updated = await service.analyze(context);
  assert.equal(updated.recomputed, true);
  assert.equal(updated.analysis.evidence.voices, 1);
  assert.equal(updated.analysis.axes.narrative.score, 85);
});
