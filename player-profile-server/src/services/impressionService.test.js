const test = require('node:test');
const assert = require('node:assert/strict');
const { createImpressionService } = require('./impressionService');

function body() {
  return {
    client_submission_id: 'submission-1',
    capture_anchor_id: 'anchor-1',
    text: 'moment',
    captured_at: '2026-07-13T12:34:56.789Z',
    playtime: { elapsed_ms: 5000, active_ms: 4000 },
    assets: [{
      client_asset_id: 'asset-1', kind: 'screenshot', mime_type: 'image/png',
      size_bytes: 4, sha256: 'ab'.repeat(32), captured_at: '2026-07-13T12:34:56.800Z',
    }],
  };
}

function createFixture({ matchingObject = true } = {}) {
  let saved;
  let rejected;
  const repository = {
    async createOrGet(input) {
      saved = {
        id: input.impressionId, user_id: input.userId, session_id: input.sessionId,
        client_submission_id: input.clientSubmissionId, capture_anchor_id: input.captureAnchorId,
        text: input.text, captured_at: input.capturedAt,
        playtime: { elapsed_ms: input.elapsedMs, active_ms: input.activeMs },
        status: 'uploading', client: input.clientMetadata, request_hash: input.requestHash,
        assets: input.assets.map((asset) => ({
          ...asset, client_asset_id: asset.clientAssetId, object_key: asset.objectKey,
          mime_type: asset.mimeType, size_bytes: asset.sizeBytes, status: 'reserved',
        })),
      };
      return { kind: 'created', impression: saved };
    },
    async getOwned() { return saved; },
    async markRejected(id, userId, reason) { rejected = reason; },
    async markProcessing() { return { ...saved, status: 'processing' }; },
  };
  const storage = {
    requireConfigured() {},
    createUpload(key) { return { url: `https://upload.test/${key}`, headers: {} }; },
    createDownload(key) { return { url: `https://download.test/${key}`, expires_in_seconds: 300 }; },
    async head() {
      return matchingObject
        ? { sizeBytes: 4, checksumSha256: Buffer.from('ab'.repeat(32), 'hex').toString('base64') }
        : { sizeBytes: 3, checksumSha256: 'wrong' };
    },
  };
  let identifier = 0;
  return {
    service: createImpressionService({ repository, storage, newIdentifier: () => `id-${++identifier}` }),
    rejected: () => rejected,
    makeReady() {
      saved.status = 'ready';
      saved.assets[0].status = 'ready';
      saved.assets[0].delivery_object_key = 'processed/id-1/id-2.png';
      saved.assets[0].thumbnail_object_key = 'processed/id-1/id-2.thumb.jpg';
      saved.assets[0].delivery_mime_type = 'image/png';
      saved.assets[0].delivery_size_bytes = 4;
    },
  };
}

test('creates a checksum-constrained upload reservation', async () => {
  const fixture = createFixture();
  const result = await fixture.service.create({
    sessionId: 'session-1', userId: 'user-1', idempotencyKey: 'submission-1', body: body(),
  });
  assert.equal(result.created, true);
  assert.match(result.impression.assets[0].upload.url, /impressions\/user-1\/id-1\/id-2\.png/);
  assert.equal(result.impression.assets[0].object_key, undefined);
});

test('rejects an upload whose size or checksum differs', async () => {
  const fixture = createFixture({ matchingObject: false });
  await fixture.service.create({
    sessionId: 'session-1', userId: 'user-1', idempotencyKey: 'submission-1', body: body(),
  });
  await assert.rejects(
    fixture.service.complete({ impressionId: 'id-1', userId: 'user-1' }),
    /does not match/
  );
  assert.match(fixture.rejected(), /does not match/);
});

test('requires the header idempotency key to match the payload', async () => {
  const fixture = createFixture();
  await assert.rejects(
    fixture.service.create({
      sessionId: 'session-1', userId: 'user-1', idempotencyKey: 'different', body: body(),
    }),
    /Idempotency-Key/
  );
});

test('returns short-lived delivery URLs but never private object keys', async () => {
  const fixture = createFixture();
  await fixture.service.create({
    sessionId: 'session-1', userId: 'user-1', idempotencyKey: 'submission-1', body: body(),
  });
  fixture.makeReady();
  const impression = await fixture.service.get({ impressionId: 'id-1', userId: 'user-1' });
  const asset = impression.assets[0];
  assert.equal(asset.delivery.url, 'https://download.test/processed/id-1/id-2.png');
  assert.equal(asset.thumbnail.url, 'https://download.test/processed/id-1/id-2.thumb.jpg');
  assert.equal(asset.object_key, undefined);
  assert.equal(asset.delivery_object_key, undefined);
  assert.equal(asset.thumbnail_object_key, undefined);
});
