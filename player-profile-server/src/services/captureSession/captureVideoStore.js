// Screen-recording and face-camera storage for capture sessions
// (spec/feature/emotion-capture-companion.md §録画). Two media kinds share one
// store because they only differ in the directory they live in: both are one
// file per session, both stay outside the evidence-media registry, and both are
// replayed on the session clock via the startSessionMs kept on the record.
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const {
  assertSafeSegment,
  collectionDirectory,
  insideRepository,
} = require('../profileDataPaths');
const { resolveMediaFile, saveMediaStream, unsupportedMediaType } = require('./captureMediaFile');

// `screen` is the gameplay recording (getDisplayMedia or an external recorder),
// `face` is the player-facing camera used for post-hoc gaze estimation.
const VIDEO_KINDS = Object.freeze({
  screen: 'capture-screen',
  face: 'capture-face',
});

// A whole play session in one file. Browser MediaRecorder output at 1080p sits
// around 1-3GB/hour, external recorders (OBS) somewhat higher; 8GB bounds a
// runaway upload without rejecting a long real session.
const VIDEO_RULE = Object.freeze({
  contentTypes: Object.freeze({
    'video/webm': '.webm',
    'video/mp4': '.mp4',
    'video/quicktime': '.mov',
    'video/x-matroska': '.mkv',
  }),
  maximumBytes: 8 * 1024 * 1024 * 1024,
});

/** @implements SPEC-EMOTION-CAPTURE-COMPANION */
function assertVideoKind(kind) {
  if (!Object.hasOwn(VIDEO_KINDS, kind)) {
    throw Object.assign(new Error(`Unknown capture video kind: ${kind}`), {
      statusCode: 400,
      code: 'INVALID_CAPTURE_INPUT',
    });
  }
  return VIDEO_KINDS[kind];
}

/** @implements SPEC-EMOTION-CAPTURE-COMPANION */
class CaptureVideoStore {
  directory({ repositoryRoot, name }, kind) {
    return insideRepository(
      collectionDirectory(repositoryRoot, 'media', name),
      assertVideoKind(kind)
    );
  }

  async save({ repositoryRoot, name, sessionId, kind, contentType, stream }) {
    const extension = VIDEO_RULE.contentTypes[contentType];
    if (!extension) throw unsupportedMediaType('video');
    assertSafeSegment(sessionId, 'Session ID');
    const directory = this.directory({ repositoryRoot, name }, kind);
    const filePath = insideRepository(directory, `${sessionId}${extension}`);
    const saved = await saveMediaStream({
      filePath,
      stream,
      maximumBytes: VIDEO_RULE.maximumBytes,
    });
    // A re-upload in another container must not leave the previous file
    // behind, or resolve() could pick the stale one first.
    await Promise.all(Object.values(VIDEO_RULE.contentTypes)
      .filter((other) => other !== extension)
      .map((other) => fsPromises.unlink(path.join(directory, `${sessionId}${other}`))
        .catch((error) => { if (error.code !== 'ENOENT') throw error; })));
    return { ...saved, contentType, kind };
  }

  async resolve({ repositoryRoot, name, sessionId, kind }) {
    assertSafeSegment(sessionId, 'Session ID');
    return resolveMediaFile({
      directory: this.directory({ repositoryRoot, name }, kind),
      baseName: sessionId,
      contentTypes: VIDEO_RULE.contentTypes,
    });
  }
}

module.exports = { VIDEO_KINDS, VIDEO_RULE, CaptureVideoStore, assertVideoKind };
