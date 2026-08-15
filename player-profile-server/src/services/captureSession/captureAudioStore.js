// Session-audio storage for the capture companion. Mirrors ProfileMediaStore's
// stream-to-temp-then-rename behaviour but is a separate store on purpose:
// capture media is not evidence media, and registering it in the shared
// registry would force a Cernere column declaration the capture feature does
// not want yet (spec/feature/emotion-capture-companion.md 非目標).
const {
  assertSafeSegment,
  collectionDirectory,
  insideRepository,
} = require('../profileDataPaths');
const { resolveMediaFile, saveMediaStream, unsupportedMediaType } = require('./captureMediaFile');

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
    if (!extension) throw unsupportedMediaType('audio');
    assertSafeSegment(sessionId, 'Session ID');
    const directory = this.directory({ repositoryRoot, name });
    const filePath = insideRepository(directory, `${sessionId}${extension}`);
    const saved = await saveMediaStream({
      filePath,
      stream,
      maximumBytes: AUDIO_RULE.maximumBytes,
    });
    return { ...saved, contentType };
  }

  async resolve({ repositoryRoot, name, sessionId }) {
    assertSafeSegment(sessionId, 'Session ID');
    return resolveMediaFile({
      directory: this.directory({ repositoryRoot, name }),
      baseName: sessionId,
      contentTypes: AUDIO_RULE.contentTypes,
    });
  }
}

module.exports = { AUDIO_MEDIA_KIND, AUDIO_RULE, CaptureAudioStore };
