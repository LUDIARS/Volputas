const { AppError } = require('../middleware/errorHandler');
const repository = require('../models/impressionReactionRepository');
const { aggregateTimeline, saveTimeline } = require('./affectTimeline');

const RAW_SCHEMA_VERSION = 'spectator.reaction-raw/v2';

function createImpressionReactionAnalysisService({
  reactionRepository = repository,
  aggregate = aggregateTimeline,
  save = saveTimeline,
} = {}) {
  async function rawData({ impressionId, userId }) {
    const context = await reactionRepository.getVideoContext(impressionId, userId);
    if (!context) throw new AppError(404, 'NOT_FOUND', 'Impression not found');
    if (context.durationMs === null || !context.videoSha256 || !context.videoMimeType) {
      throw new AppError(409, 'VIDEO_REQUIRED', 'Impression does not contain a video');
    }
    const reactions = await reactionRepository.listOwned(impressionId, userId);
    if (reactions.length === 0) {
      throw new AppError(409, 'REACTIONS_REQUIRED', 'At least one self-reported reaction is required');
    }
    return {
      schemaVersion: RAW_SCHEMA_VERSION,
      sourceKind: 'self_report',
      gameId: context.gameId,
      sourceRef: context.videoSha256,
      source: {
        draftId: impressionId,
        captureAnchorId: context.captureAnchorId,
        videoSha256: context.videoSha256,
        mimeType: context.videoMimeType,
        durationMs: context.durationMs,
        clipStartedAt: context.clipStartedAt,
        clipEndedAt: context.clipEndedAt,
      },
      utterances: reactions.map((reaction) => ({
        id: reaction.id,
        videoOffsetMs: reaction.video_offset_ms,
        reactionKind: reaction.kind,
        content: reaction.content,
        recordedAt: reaction.recorded_at,
      })),
    };
  }

  return {
    rawData,

    async createTimeline({ impressionId, userId, binMs = 30_000 }) {
      if (!Number.isSafeInteger(binMs) || binMs <= 0) {
        throw new AppError(400, 'INVALID_INPUT', 'bin_ms must be a positive integer');
      }
      const raw = await rawData({ impressionId, userId });
      const aggregated = aggregate(raw.utterances, binMs);
      return save({
        gameId: raw.gameId,
        sourceKind: 'video_comments',
        sourceRef: `impression:${impressionId}`,
        binMs,
        ...aggregated,
        meta: {
          ...aggregated.meta,
          impressionId,
          reactionSourceKind: raw.sourceKind,
          reactionCount: raw.utterances.length,
        },
      });
    },
  };
}

module.exports = createImpressionReactionAnalysisService();
module.exports.RAW_SCHEMA_VERSION = RAW_SCHEMA_VERSION;
module.exports.createImpressionReactionAnalysisService = createImpressionReactionAnalysisService;
