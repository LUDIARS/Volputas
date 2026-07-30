const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { randomUUID } = require('node:crypto');
const {
  assertSafeSegment,
  collectionDirectory,
  insideRepository,
} = require('./profileDataPaths');

// Media policy is identical in local and authenticated modes.
const MEDIA_RULES = {
  screenshots: {
    contentTypes: {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
    },
    maximumBytes: 20 * 1024 * 1024,
  },
  voicememos: {
    contentTypes: {
      'audio/webm': '.webm',
      'audio/ogg': '.ogg',
      'audio/mp4': '.m4a',
      'audio/mpeg': '.mp3',
    },
    maximumBytes: 50 * 1024 * 1024,
  },
  videos: {
    contentTypes: {
      'video/mp4': '.mp4',
      'video/webm': '.webm',
      'video/quicktime': '.mov',
    },
    maximumBytes: 2 * 1024 * 1024 * 1024,
  },
  gamelogs: {
    contentTypes: {
      'text/plain': '.log',
      'application/json': '.json',
      'text/csv': '.csv',
    },
    maximumBytes: 100 * 1024 * 1024,
  },
};

class ProfileMediaStore {
  async save({ repositoryRoot, name, kind, recordId, contentType, stream }) {
    const rule = MEDIA_RULES[kind];
    const extension = rule?.contentTypes[contentType];
    if (!rule || !extension) {
      throw Object.assign(new Error('Unsupported media type'), { code: 'UNSUPPORTED_MEDIA_TYPE' });
    }
    assertSafeSegment(recordId, 'Record ID');
    const directory = collectionDirectory(repositoryRoot, 'media', name);
    const kindDirectory = insideRepository(directory, kind);
    const filePath = insideRepository(kindDirectory, `${recordId}${extension}`);
    const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    let bytes = 0;
    const limiter = new Transform({
      transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > rule.maximumBytes) {
          callback(Object.assign(new Error('Media file is too large'), {
            code: 'MEDIA_TOO_LARGE',
          }));
          return;
        }
        callback(null, chunk);
      },
    });

    await fsPromises.mkdir(kindDirectory, { recursive: true });
    try {
      await pipeline(stream, limiter, fs.createWriteStream(temporaryPath, { flags: 'wx' }));
      await fsPromises.rename(temporaryPath, filePath);
      return { filePath, bytes, contentType };
    } catch (error) {
      await fsPromises.unlink(temporaryPath).catch(() => {});
      throw error;
    }
  }

  async resolve({ repositoryRoot, name, kind, recordId }) {
    const rule = MEDIA_RULES[kind];
    if (!rule) return null;
    assertSafeSegment(recordId, 'Record ID');
    const directory = insideRepository(
      collectionDirectory(repositoryRoot, 'media', name),
      kind
    );
    for (const [contentType, extension] of Object.entries(rule.contentTypes)) {
      const filePath = path.join(directory, `${recordId}${extension}`);
      try {
        await fsPromises.access(filePath);
        return { filePath, contentType };
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    return null;
  }

  async remove(context) {
    const media = await this.resolve(context);
    if (!media) return false;
    await fsPromises.unlink(media.filePath);
    return true;
  }
}

module.exports = { MEDIA_RULES, ProfileMediaStore };
