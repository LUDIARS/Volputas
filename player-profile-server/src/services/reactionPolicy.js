const { AppError } = require('../middleware/errorHandler');

const REACTION_KINDS = new Set(['comment', 'positive', 'negative']);

function invalid(message) {
  throw new AppError(400, 'INVALID_REACTION', message);
}

function validateReactionInput(body, defaultRecordedAt) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    invalid('request body must be an object');
  }
  if (!Number.isSafeInteger(body.video_offset_ms) || body.video_offset_ms < 0) {
    invalid('video_offset_ms must be a non-negative integer');
  }
  if (typeof body.kind !== 'string' || !REACTION_KINDS.has(body.kind)) {
    invalid('kind must be comment, positive, or negative');
  }
  if (typeof body.content !== 'string' || body.content.trim().length === 0 || body.content.length > 2000) {
    invalid('content must contain 1 to 2000 characters');
  }

  const recordedAt = body.recorded_at === undefined ? defaultRecordedAt : body.recorded_at;
  if (typeof recordedAt !== 'string' || !Number.isFinite(new Date(recordedAt).getTime())) {
    invalid('recorded_at must be an ISO-8601 timestamp');
  }

  return {
    videoOffsetMs: body.video_offset_ms,
    kind: body.kind,
    content: body.content,
    recordedAt: new Date(recordedAt).toISOString(),
  };
}

module.exports = { REACTION_KINDS, validateReactionInput };
