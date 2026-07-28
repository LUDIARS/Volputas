const test = require('node:test');
const assert = require('node:assert/strict');
const { MediaWorker } = require('./mediaWorker');

function result(assetId = 'asset-1') {
  return {
    assetId,
    deliveryObjectKey: `processed/${assetId}.mp4`,
    thumbnailObjectKey: `processed/${assetId}.jpg`,
  };
}

test('deletes generated derivatives when deletion won the database race', async () => {
  const deleted = [];
  const repository = {
    async claimProcessingJob() { return { id: 'impression-1', processing_attempts: 1, assets: [] }; },
    async completeProcessing() { return false; },
  };
  const storage = { async delete(key) { deleted.push(key); } };
  const worker = new MediaWorker({
    repository,
    storage,
    processor: { async process() { return [result()]; } },
  });
  assert.equal(await worker.processOne(), true);
  assert.deepEqual(deleted, ['processed/asset-1.mp4', 'processed/asset-1.jpg']);
});

test('continues original cleanup after an individual storage failure', async () => {
  const marked = [];
  const errors = [];
  const repository = {
    async listExpiredOriginals() {
      return [
        { id: 'asset-1', object_key: 'original-1' },
        { id: 'asset-2', object_key: 'original-2' },
      ];
    },
    async markOriginalDeleted(id) { marked.push(id); },
  };
  const storage = {
    async delete(key) {
      if (key === 'original-1') throw new Error('temporary storage failure');
    },
  };
  const worker = new MediaWorker({
    repository,
    storage,
    processor: {},
    onCleanupError: (error, asset) => errors.push([error.message, asset.id]),
  });
  assert.equal(await worker.cleanupExpiredOriginals(), 1);
  assert.deepEqual(marked, ['asset-2']);
  assert.deepEqual(errors, [['temporary storage failure', 'asset-1']]);
});

test('schedules a transient processing failure with exponential delay', async () => {
  let failure;
  const now = new Date('2026-07-13T00:00:00.000Z');
  const repository = {
    async claimProcessingJob() { return { id: 'impression-1', processing_attempts: 3, assets: [] }; },
    async failProcessing(...argumentsList) { failure = argumentsList; },
  };
  const worker = new MediaWorker({
    repository,
    storage: {},
    processor: { async process() { throw new Error('network unavailable'); } },
    now: () => now,
  });
  await worker.processOne();
  assert.equal(failure[0], 'impression-1');
  assert.equal(failure[2], false);
  assert.equal(failure[3].toISOString(), '2026-07-13T00:00:08.000Z');
});
