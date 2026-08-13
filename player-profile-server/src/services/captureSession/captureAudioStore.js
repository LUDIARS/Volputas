// Session-audio storage for the capture companion. Mirrors ProfileMediaStore's
// stream-to-temp-then-rename behaviour but is a separate store on purpose:
// capture media is not evidence media, and registering it in the shared
// registry would force a Cernere column declaration the capture feature does
// not want yet (spec/feature/emotion-capture-companion.md 非目標).
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
} = require('../profileDataPaths');

const AUDIO_MEDIA_KIND = 'capture-audio';

// A whole play session in one file; 500MB covers hours of compressed audio and
// still bounds a runaway upload.
const AUDIO_RULE = Object.freeze({
  contentTypes: Object.freeze({
    'audio/webm': '.webm',
    'audio/ogg': '.ogg',
    'audio/mp4': '.m4a',
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
  }),
  maximumBytes: 500 * 1024 * 1024,
});

class CaptureAudioStore {
  directory({ repositoryRoot, name }) {
    return insideRepository(
      collectionDirectory(repositoryRoot, 'media', name),
      AUDIO_MEDIA_KIND
    );
  }

  async save({ repositoryRoot, name, sessionId, contentType, stream }) {
    const extension = AUDIO_RULE.contentTypes[contentType];
    if (!extension) {
      throw Object.assign(new Error('Unsupported audio type'), {
        statusCode: 415,
        code: 'UNSUPPORTED_MEDIA_TYPE',
      });
    }
    assertSafeSegment(sessionId, 'Session ID');
    const directory = this.directory({ repositoryRoot, name });
    const filePath = insideRepository(directory, `${sessionId}${extension}`);
    const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    let bytes = 0;
    const limiter = new Transform({
      transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > AUDIO_RULE.maximumBytes) {
          callback(Object.assign(new Error('Audio file is too large'), {
            statusCode: 413,
            code: 'MEDIA_TOO_LARGE',
          }));
          return;
        }
        callback(null, chunk);
      },
    });

    await fsPromises.mkdir(directory, { recursive: true });
    try {
      await pipeline(stream, limiter, fs.createWriteStream(temporaryPath, { flags: 'wx' }));
      await fsPromises.rename(temporaryPath, filePath);
      return { filePath, fileName: path.basename(filePath), bytes, contentType };
    } catch (error) {
      // The primary pipeline/rename error is more useful than a best-effort
      // cleanup failure for a temporary file that may not exist.
      await fsPromises.unlink(temporaryPath).catch(() => {});
      throw error;
    }
  }

  async resolve({ repositoryRoot, name, sessionId }) {
    assertSafeSegment(sessionId, 'Session ID');
    const directory = this.directory({ repositoryRoot, name });
    for (const [contentType, extension] of Object.entries(AUDIO_RULE.contentTypes)) {
      const filePath = path.join(directory, `${sessionId}${extension}`);
      try {
        await fsPromises.access(filePath);
        return { filePath, contentType };
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    return null;
  }
}

module.exports = { AUDIO_MEDIA_KIND, AUDIO_RULE, CaptureAudioStore };
