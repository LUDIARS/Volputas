const test = require('node:test');
const assert = require('node:assert/strict');
const { createImpressionReactionAnalysisService } = require('./impressionReactionAnalysisService');

function fixture() {
  let saved;
  const reactions = [{
    id: 'reaction-1', impression_id: 'impression-1', video_offset_ms: 1234,
    kind: 'positive', content: 'ここ良かった', recorded_at: '2026-07-15T01:00:00.000Z',
  }];
  const reactionRepository = {
    async getVideoContext() {
      return {
        impressionId: 'impression-1', durationMs: 2000, gameId: 'game',
        captureAnchorId: 'anchor', videoSha256: 'ab'.repeat(32), videoMimeType: 'video/mp4',
        clipStartedAt: null, clipEndedAt: null,
      };
    },
    async listOwned() { return reactions; },
  };
  const service = createImpressionReactionAnalysisService({
    reactionRepository,
    aggregate: (utterances, binMs) => ({ series: [{ t: 0, n: utterances.length }], meta: { binMs } }),
    save: async (input) => { saved = input; return { id: 7, ...input }; },
  });
  return { service, saved: () => saved };
}

test('exports the shared versioned self-report raw data contract', async () => {
  const { service } = fixture();
  const raw = await service.rawData({ impressionId: 'impression-1', userId: 'user-1' });
  assert.equal(raw.schemaVersion, 'spectator.reaction-raw/v2');
  assert.equal(raw.sourceRef, 'ab'.repeat(32));
  assert.deepEqual(raw.utterances[0], {
    id: 'reaction-1', videoOffsetMs: 1234, reactionKind: 'positive',
    content: 'ここ良かった', recordedAt: '2026-07-15T01:00:00.000Z',
  });
});

test('aggregates and saves the current impression reaction timeline', async () => {
  const { service, saved } = fixture();
  const timeline = await service.createTimeline({ impressionId: 'impression-1', userId: 'user-1', binMs: 1000 });
  assert.equal(timeline.id, 7);
  assert.equal(saved().sourceRef, 'impression:impression-1');
  assert.equal(saved().meta.reactionCount, 1);
  assert.equal(saved().series[0].n, 1);
});
