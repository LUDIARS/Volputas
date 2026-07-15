const { AppError } = require('../middleware/errorHandler');

const POLICIES = Object.freeze({
  screenshot: Object.freeze({
    mimeTypes: new Set(['image/jpeg', 'image/png']),
    maximumBytes: 15 * 1024 * 1024,
    requiresDuration: false,
  }),
  video: Object.freeze({
    mimeTypes: new Set(['video/mp4', 'video/x-matroska', 'video/webm']),
    maximumBytes: 200 * 1024 * 1024,
    requiresDuration: true,
  }),
});

const SPECTATOR_MAXIMUM_VIDEO_DURATION_MS = 30_000;
const WEB_REVIEW_MAXIMUM_VIDEO_DURATION_MS = 2 * 60 * 60 * 1000;

function invalid(message) {
  throw new AppError(400, 'INVALID_IMPRESSION', message);
}

function requireString(value, field, maximumLength = 64) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximumLength) {
    invalid(`${field} must be a non-empty string of at most ${maximumLength} characters`);
  }
  return value;
}

function requireDate(value, field) {
  requireString(value, field, 64);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) invalid(`${field} must be an ISO-8601 timestamp`);
  return parsed.toISOString();
}

function requireInteger(value, field, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    invalid(`${field} must be an integer greater than or equal to ${minimum}`);
  }
  return value;
}

function validateAsset(asset, seenIds, seenKinds, maximumVideoDurationMs) {
  if (!asset || typeof asset !== 'object' || Array.isArray(asset)) invalid('assets must contain objects');
  const clientAssetId = requireString(asset.client_asset_id, 'client_asset_id');
  if (seenIds.has(clientAssetId)) invalid('client_asset_id must be unique within an impression');
  seenIds.add(clientAssetId);

  const kind = requireString(asset.kind, 'kind', 20);
  const policy = POLICIES[kind];
  if (!policy) invalid(`unsupported asset kind: ${kind}`);
  if (seenKinds.has(kind)) invalid(`only one ${kind} asset is allowed`);
  seenKinds.add(kind);

  const mimeType = requireString(asset.mime_type, 'mime_type', 100).toLowerCase();
  if (!policy.mimeTypes.has(mimeType)) invalid(`${mimeType} is not allowed for ${kind}`);
  const sizeBytes = requireInteger(asset.size_bytes, 'size_bytes', 1);
  if (sizeBytes > policy.maximumBytes) invalid(`${kind} exceeds its size limit`);
  const sha256 = requireString(asset.sha256, 'sha256').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha256)) invalid('sha256 must be 64 lowercase hexadecimal characters');

  let durationMs = null;
  if (policy.requiresDuration) {
    durationMs = requireInteger(asset.duration_ms, 'duration_ms', 1);
    if (durationMs > maximumVideoDurationMs) {
      invalid(`video duration must not exceed ${maximumVideoDurationMs} milliseconds`);
    }
  }

  return {
    clientAssetId,
    kind,
    mimeType,
    sizeBytes,
    sha256,
    durationMs,
    width: asset.width === undefined ? null : requireInteger(asset.width, 'width', 1),
    height: asset.height === undefined ? null : requireInteger(asset.height, 'height', 1),
    capturedAt: asset.captured_at ? requireDate(asset.captured_at, 'captured_at') : null,
    clipStartedAt: asset.clip_started_at ? requireDate(asset.clip_started_at, 'clip_started_at') : null,
    clipEndedAt: asset.clip_ended_at ? requireDate(asset.clip_ended_at, 'clip_ended_at') : null,
    metadata: asset.metadata && typeof asset.metadata === 'object' && !Array.isArray(asset.metadata)
      ? asset.metadata
      : {},
  };
}

function validateImpressionInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('request body must be an object');
  const text = typeof body.text === 'string' ? body.text : invalid('text must be a string');
  if (text.length > 2000) invalid('text must be at most 2000 characters');
  const playtime = body.playtime;
  if (!playtime || typeof playtime !== 'object' || Array.isArray(playtime)) invalid('playtime is required');
  const elapsedMs = requireInteger(playtime.elapsed_ms, 'playtime.elapsed_ms');
  const activeMs = requireInteger(playtime.active_ms, 'playtime.active_ms');
  if (activeMs > elapsedMs) invalid('active_ms must not exceed elapsed_ms');
  const assets = body.assets === undefined ? [] : body.assets;
  if (!Array.isArray(assets) || assets.length > 2) invalid('assets must be an array with at most two items');
  const seenIds = new Set();
  const seenKinds = new Set();
  const clientMetadata = body.client && typeof body.client === 'object' && !Array.isArray(body.client)
    ? body.client
    : {};
  const maximumVideoDurationMs = clientMetadata.source === 'volputas_web_review'
    ? WEB_REVIEW_MAXIMUM_VIDEO_DURATION_MS
    : SPECTATOR_MAXIMUM_VIDEO_DURATION_MS;

  return {
    clientSubmissionId: requireString(body.client_submission_id, 'client_submission_id'),
    captureAnchorId: requireString(body.capture_anchor_id, 'capture_anchor_id'),
    text,
    capturedAt: requireDate(body.captured_at, 'captured_at'),
    elapsedMs,
    activeMs,
    clientMetadata,
    assets: assets.map((asset) => validateAsset(
      asset,
      seenIds,
      seenKinds,
      maximumVideoDurationMs
    )),
  };
}

module.exports = {
  POLICIES,
  SPECTATOR_MAXIMUM_VIDEO_DURATION_MS,
  WEB_REVIEW_MAXIMUM_VIDEO_DURATION_MS,
  validateImpressionInput,
};
