const test = require('node:test');
const assert = require('node:assert/strict');
const { createImpressionReactionService } = require('./impressionReactionService');

function createFixture(overrides = {}) {
  const saved = [];
  const repository = {
    async getVideoContext() {
      return {
        impressionId: 'impression-1',
        impressionStatus: 'ready',
        assetStatus: 'ready',
        durationMs: 10_000,
        ...overrides.context,
      };
    },
    async listOwned() { return saved; },
    async create(input) {
      const reaction = {
        id: input.id,
        impression_id: input.impressionId,
        video_offset_ms: input.videoOffsetMs,
        kind: input.kind,
        content: input.content,
        recorded_at: input.recordedAt,
      };
      saved.push(reaction);
      return reaction;
    },
    async removeOwned() { return overrides.removed ?? true; },
  };
  return createImpressionReactionService({
    reactionRepository: repository,
    newIdentifier: () => 'reaction-1',
    now: () => '2026-07-14T03:00:00.000Z',
  });
}

test('records a self-reported reaction at the requested video offset', async () => {
  const service = createFixture();
  const reaction = await service.add({
    impressionId: 'impression-1',
    userId: 'user-1',
    body: { video_offset_ms: 4321, kind: 'positive', content: 'ここ良かった' },
  });
  assert.deepEqual(reaction, {
    id: 'reaction-1',
    impression_id: 'impression-1',
    video_offset_ms: 4321,
    kind: 'positive',
    content: 'ここ良かった',
    recorded_at: '2026-07-14T03:00:00.000Z',
  });
});

test('rejects a reaction outside the video duration', async () => {
  const service = createFixture();
  await assert.rejects(
    service.add({
      impressionId: 'impression-1',
      userId: 'user-1',
      body: { video_offset_ms: 10_001, kind: 'negative', content: 'ここ悪かった' },
    }),
    /must not exceed the video duration/
  );
});

test('requires a ready video before accepting a reaction', async () => {
  const service = createFixture({ context: { impressionStatus: 'processing' } });
  await assert.rejects(
    service.add({
      impressionId: 'impression-1',
      userId: 'user-1',
      body: { video_offset_ms: 100, kind: 'comment', content: 'メモ' },
    }),
    /not ready/
  );
});
