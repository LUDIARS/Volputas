const crypto = require('node:crypto');
const config = require('../config');
const impressionRepository = require('../models/impressionRepository');
const { S3MediaStorage } = require('./mediaStorage');
const { MediaCommandRunner } = require('./mediaCommandRunner');
const { MediaProcessor } = require('./mediaProcessor');
const { ProcessingError } = require('./processingError');

class MediaWorker {
  constructor({
    repository = impressionRepository,
    storage = new S3MediaStorage(),
    processor,
    workerId = `media-${crypto.randomUUID()}`,
    now = () => new Date(),
    retentionDays = config.mediaWorker.originalRetentionDays,
    onCleanupError = (error, asset) => process.stderr.write(`${JSON.stringify({
      level: 'error', event: 'media_original_cleanup_failed', asset_id: asset.id, message: error.message,
    })}\n`),
  } = {}) {
    this.repository = repository;
    this.storage = storage;
    this.processor = processor || new MediaProcessor({
      storage,
      commandRunner: new MediaCommandRunner(config.mediaWorker),
      workRoot: config.mediaWorker.workRoot,
    });
    this.workerId = workerId;
    this.now = now;
    this.retentionDays = retentionDays;
    this.onCleanupError = onCleanupError;
  }

  async processOne() {
    const impression = await this.repository.claimProcessingJob(this.workerId);
    if (!impression) return false;
    try {
      const results = await this.processor.process(impression);
      const deleteAfter = new Date(this.now().getTime() + this.retentionDays * 86_400_000);
      const committed = await this.repository.completeProcessing(impression.id, results, deleteAfter);
      if (!committed) await this.deleteProcessedResults(results);
    } catch (error) {
      const attempts = impression.processing_attempts;
      const permanent = error instanceof ProcessingError ? error.permanent : attempts >= 5;
      const delaySeconds = Math.min(900, 2 ** Math.min(attempts, 9));
      await this.repository.failProcessing(
        impression.id,
        error.message,
        permanent,
        new Date(this.now().getTime() + delaySeconds * 1000)
      );
    }
    return true;
  }

  async cleanupExpiredOriginals() {
    const assets = await this.repository.listExpiredOriginals();
    let deleted = 0;
    for (const asset of assets) {
      try {
        await this.storage.delete(asset.object_key);
        await this.repository.markOriginalDeleted(asset.id);
        deleted += 1;
      } catch (error) {
        this.onCleanupError(error, asset);
      }
    }
    return deleted;
  }

  async deleteProcessedResults(results) {
    for (const result of results) {
      await this.storage.delete(result.deliveryObjectKey);
      if (result.thumbnailObjectKey) await this.storage.delete(result.thumbnailObjectKey);
    }
  }
}

module.exports = { MediaWorker };
