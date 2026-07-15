const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ProcessingError } = require('./processingError');
const {
  SPECTATOR_MAXIMUM_VIDEO_DURATION_MS,
  WEB_REVIEW_MAXIMUM_VIDEO_DURATION_MS,
} = require('./mediaPolicy');

const MAGIC = Object.freeze({
  'image/jpeg': (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  'image/png': (bytes) => bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
  'video/mp4': (bytes) => bytes.subarray(4, 8).toString('ascii') === 'ftyp',
  'video/x-matroska': (bytes) => bytes.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex')),
  'video/webm': (bytes) => bytes.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex')),
});

class MediaProcessor {
  constructor({ storage, commandRunner, workRoot = '' }) {
    this.storage = storage;
    this.commandRunner = commandRunner;
    this.workRoot = workRoot || os.tmpdir();
  }

  async process(impression) {
    const directory = await fs.promises.mkdtemp(path.join(this.workRoot, 'volputas-media-'));
    try {
      const results = [];
      const maximumVideoDurationMs = this.maximumVideoDurationMs(impression);
      for (const asset of impression.assets) {
        results.push(await this.processAsset(impression.id, asset, directory, maximumVideoDurationMs));
      }
      return results;
    } finally {
      await fs.promises.rm(directory, { recursive: true, force: true });
    }
  }

  async processAsset(impressionId, asset, directory, maximumVideoDurationMs) {
    const input = path.join(directory, `${asset.id}.input`);
    await this.storage.download(asset.object_key, input);
    await this.verifyMagic(input, asset.mime_type);
    await this.commandRunner.scan(input);
    const probe = await this.commandRunner.probe(input);
    if (asset.kind === 'screenshot') return this.processScreenshot(impressionId, asset, input, probe, directory);
    if (asset.kind === 'video') {
      return this.processVideo(impressionId, asset, input, probe, directory, maximumVideoDurationMs);
    }
    throw new ProcessingError(`Unsupported asset kind: ${asset.kind}`, true);
  }

  async processScreenshot(impressionId, asset, input, probe, directory) {
    const videoStream = this.requireSingleVideoStream(probe);
    this.validateDimensions(videoStream, 67_108_864);
    const extension = asset.mime_type === 'image/png' ? 'png' : 'jpg';
    const output = path.join(directory, `${asset.id}.${extension}`);
    const thumbnail = path.join(directory, `${asset.id}.thumb.jpg`);
    await this.commandRunner.sanitizeImage(input, output, thumbnail);
    const deliveryObjectKey = `processed/${impressionId}/${asset.id}.${extension}`;
    const thumbnailObjectKey = `processed/${impressionId}/${asset.id}.thumb.jpg`;
    const deliverySizeBytes = await this.storage.uploadProcessed(deliveryObjectKey, output, asset.mime_type);
    await this.storage.uploadProcessed(thumbnailObjectKey, thumbnail, 'image/jpeg');
    return {
      assetId: asset.id,
      deliveryObjectKey,
      thumbnailObjectKey,
      deliveryMimeType: asset.mime_type,
      deliverySizeBytes,
      width: videoStream.width,
      height: videoStream.height,
      durationMs: null,
      metadata: { metadata_stripped: true },
    };
  }

  async processVideo(impressionId, asset, input, probe, directory, maximumVideoDurationMs) {
    const videoStream = this.requireSingleVideoStream(probe);
    this.validateDimensions(videoStream, 33_554_432);
    const durationMs = Math.round(Number.parseFloat(probe.format?.duration || '0') * 1000);
    if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > maximumVideoDurationMs + 500) {
      throw new ProcessingError(`Video duration is missing or exceeds ${maximumVideoDurationMs} milliseconds.`, true);
    }
    const output = path.join(directory, `${asset.id}.mp4`);
    await this.commandRunner.transcodeVideo(input, output, maximumVideoDurationMs);
    const deliveryObjectKey = `processed/${impressionId}/${asset.id}.mp4`;
    const deliverySizeBytes = await this.storage.uploadProcessed(deliveryObjectKey, output, 'video/mp4');
    return {
      assetId: asset.id,
      deliveryObjectKey,
      thumbnailObjectKey: null,
      deliveryMimeType: 'video/mp4',
      deliverySizeBytes,
      width: videoStream.width,
      height: videoStream.height,
      durationMs,
      metadata: { transcoded: true, source_mime_type: asset.mime_type },
    };
  }

  maximumVideoDurationMs(impression) {
    return impression.client?.source === 'volputas_web_review'
      ? WEB_REVIEW_MAXIMUM_VIDEO_DURATION_MS
      : SPECTATOR_MAXIMUM_VIDEO_DURATION_MS;
  }

  async verifyMagic(filePath, mimeType) {
    const predicate = MAGIC[mimeType];
    if (!predicate) throw new ProcessingError(`Unsupported MIME type: ${mimeType}`, true);
    const handle = await fs.promises.open(filePath, 'r');
    try {
      const bytes = Buffer.alloc(16);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      if (bytesRead < 8 || !predicate(bytes)) {
        throw new ProcessingError(`Magic bytes do not match ${mimeType}.`, true);
      }
    } finally {
      await handle.close();
    }
  }

  requireSingleVideoStream(probe) {
    const streams = Array.isArray(probe.streams)
      ? probe.streams.filter((stream) => stream.codec_type === 'video')
      : [];
    if (streams.length !== 1 || !Number.isInteger(streams[0].width) || !Number.isInteger(streams[0].height)) {
      throw new ProcessingError('Media must contain exactly one decodable video or image stream.', true);
    }
    return streams[0];
  }

  validateDimensions(stream, maximumPixels) {
    if (stream.width > 16_384 || stream.height > 16_384 || stream.width * stream.height > maximumPixels) {
      throw new ProcessingError('Media dimensions exceed the decoding safety limit.', true);
    }
  }
}

module.exports = { MediaProcessor };
