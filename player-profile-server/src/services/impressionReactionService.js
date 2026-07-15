const crypto = require('node:crypto');
const { AppError } = require('../middleware/errorHandler');
const repository = require('../models/impressionReactionRepository');
const { validateReactionInput } = require('./reactionPolicy');

function createImpressionReactionService({
  reactionRepository = repository,
  newIdentifier = () => crypto.randomUUID(),
  now = () => new Date().toISOString(),
} = {}) {
  async function requireVideo(impressionId, userId, requireReady) {
    const context = await reactionRepository.getVideoContext(impressionId, userId);
    if (!context) throw new AppError(404, 'NOT_FOUND', 'Impression not found');
    if (context.durationMs === null) {
      throw new AppError(409, 'VIDEO_REQUIRED', 'Impression does not contain a video');
    }
    if (requireReady && (context.impressionStatus !== 'ready' || context.assetStatus !== 'ready')) {
      throw new AppError(409, 'VIDEO_NOT_READY', 'Video is not ready for review');
    }
    return context;
  }

  return {
    async list({ impressionId, userId }) {
      await requireVideo(impressionId, userId, false);
      return reactionRepository.listOwned(impressionId, userId);
    },

    async add({ impressionId, userId, body }) {
      const input = validateReactionInput(body, now());
      const context = await requireVideo(impressionId, userId, true);
      if (input.videoOffsetMs > context.durationMs) {
        throw new AppError(400, 'INVALID_REACTION', 'video_offset_ms must not exceed the video duration');
      }
      return reactionRepository.create({
        ...input,
        id: newIdentifier(),
        impressionId,
      });
    },

    async remove({ reactionId, impressionId, userId }) {
      await requireVideo(impressionId, userId, false);
      const removed = await reactionRepository.removeOwned(reactionId, impressionId, userId);
      if (!removed) throw new AppError(404, 'NOT_FOUND', 'Reaction not found');
    },
  };
}

module.exports = createImpressionReactionService();
module.exports.createImpressionReactionService = createImpressionReactionService;
