const crypto = require('node:crypto');
const { AppError } = require('../middleware/errorHandler');
const impressionRepository = require('../models/impressionRepository');
const { S3MediaStorage } = require('./mediaStorage');
const { validateImpressionInput } = require('./mediaPolicy');

const MIME_EXTENSIONS = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'video/mp4': 'mp4',
  'video/x-matroska': 'mkv',
  'video/webm': 'webm',
});

function requestHash(input) {
  return crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function publicImpression(impression, storage) {
  const result = { ...impression };
  delete result.user_id;
  delete result.request_hash;
  result.assets = impression.assets.map((asset) => {
    const item = { ...asset };
    delete item.object_key;
    delete item.delivery_object_key;
    delete item.thumbnail_object_key;
    delete item.original_delete_after;
    if (asset.status === 'reserved') item.upload = storage.createUpload(asset.object_key, asset.sha256);
    if (asset.status === 'ready' && asset.delivery_object_key) {
      item.delivery = {
        ...storage.createDownload(asset.delivery_object_key),
        mime_type: asset.delivery_mime_type,
        size_bytes: asset.delivery_size_bytes,
      };
    }
    if (asset.status === 'ready' && asset.thumbnail_object_key) {
      item.thumbnail = storage.createDownload(asset.thumbnail_object_key);
    }
    return item;
  });
  return result;
}

function createImpressionService({
  repository = impressionRepository,
  storage = new S3MediaStorage(),
  newIdentifier = () => crypto.randomUUID(),
} = {}) {
  return {
    async create({ sessionId, userId, idempotencyKey, body }) {
      const normalized = validateImpressionInput(body);
      if (typeof idempotencyKey !== 'string' || idempotencyKey !== normalized.clientSubmissionId) {
        throw new AppError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key must equal client_submission_id');
      }
      if (normalized.assets.length > 0) storage.requireConfigured();
      const impressionId = newIdentifier();
      const assets = normalized.assets.map((asset) => {
        const id = newIdentifier();
        return {
          ...asset,
          id,
          objectKey: `impressions/${userId}/${impressionId}/${id}.${MIME_EXTENSIONS[asset.mimeType]}`,
        };
      });
      const result = await repository.createOrGet({
        ...normalized,
        assets,
        sessionId,
        userId,
        impressionId,
        requestHash: requestHash(normalized),
      });
      if (result.kind === 'session_not_found') throw new AppError(404, 'NOT_FOUND', 'Session not found');
      if (result.kind === 'idempotency_conflict') {
        throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key was already used for different content');
      }
      return { created: result.kind === 'created', impression: publicImpression(result.impression, storage) };
    },

    async complete({ impressionId, userId }) {
      const impression = await repository.getOwned(impressionId, userId);
      if (!impression) throw new AppError(404, 'NOT_FOUND', 'Impression not found');
      if (['processing', 'ready'].includes(impression.status)) return publicImpression(impression, storage);
      if (impression.status === 'rejected') throw new AppError(409, 'IMPRESSION_REJECTED', impression.rejection_reason);
      if (impression.assets.length > 0) storage.requireConfigured();

      for (const asset of impression.assets) {
        const object = await storage.head(asset.object_key);
        const expectedChecksum = Buffer.from(asset.sha256, 'hex').toString('base64');
        if (!object || object.sizeBytes !== asset.size_bytes
          || (object.checksumSha256 !== expectedChecksum && object.metadataSha256 !== asset.sha256)) {
          const reason = `Uploaded ${asset.kind} does not match its reserved size and SHA-256`;
          await repository.markRejected(impressionId, userId, reason);
          throw new AppError(422, 'MEDIA_MISMATCH', reason);
        }
      }

      return publicImpression(await repository.markProcessing(impressionId, userId), storage);
    },

    async get({ impressionId, userId }) {
      const impression = await repository.getOwned(impressionId, userId);
      if (!impression) throw new AppError(404, 'NOT_FOUND', 'Impression not found');
      return publicImpression(impression, storage);
    },

    async remove({ impressionId, userId }) {
      const impression = await repository.beginDeletion(impressionId, userId);
      if (!impression) throw new AppError(404, 'NOT_FOUND', 'Impression not found');
      try {
        for (const asset of impression.assets) {
          await storage.delete(asset.object_key);
          if (asset.delivery_object_key) await storage.delete(asset.delivery_object_key);
          if (asset.thumbnail_object_key) await storage.delete(asset.thumbnail_object_key);
        }
        await repository.finishDeletion(impressionId, userId, impression.assets.length);
      } catch (error) {
        await repository.recordDeletionFailure(impressionId, userId, impression.assets.length);
        throw error;
      }
    },
  };
}

module.exports = createImpressionService();
module.exports.createImpressionService = createImpressionService;
