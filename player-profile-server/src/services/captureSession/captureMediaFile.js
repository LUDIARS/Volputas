// Shared stream-to-file primitive for capture media (audio, screen and face
// recordings). Streams into a temporary sibling, enforces a byte ceiling while
// streaming and renames into place, so a partially uploaded file never appears
// under the final name. Kept free of any store-specific policy so each store
// only decides content types, limits and directory layout.
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { randomUUID } = require('node:crypto');

/** @implements SPEC-EMOTION-CAPTURE-COMPANION */
function byteLimiter(maximumBytes, onBytes) {
  let bytes = 0;
  return new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      onBytes(bytes);
      if (bytes > maximumBytes) {
        callback(Object.assign(new Error('Media file is too large'), {
          statusCode: 413,
          code: 'MEDIA_TOO_LARGE',
        }));
        return;
      }
      callback(null, chunk);
    },
  });
}

/** @implements SPEC-EMOTION-CAPTURE-COMPANION */
async function saveMediaStream({ filePath, stream, maximumBytes }) {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  let bytes = 0;
  await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await pipeline(
      stream,
      byteLimiter(maximumBytes, (total) => { bytes = total; }),
      fs.createWriteStream(temporaryPath, { flags: 'wx' })
    );
    if (bytes === 0) {
      throw Object.assign(new Error('Media file is empty'), {
        statusCode: 400,
        code: 'EMPTY_MEDIA_FILE',
      });
    }
    await fsPromises.rename(temporaryPath, filePath);
    return { filePath, fileName: path.basename(filePath), bytes };
  } catch (error) {
    // The primary pipeline/rename error is more useful than a best-effort
    // cleanup failure for a temporary file that may not exist.
    await fsPromises.unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

// Finds which of the allowed extensions exists for a base name; the first
// match wins because a store writes exactly one file per id.
/** @implements SPEC-EMOTION-CAPTURE-COMPANION */
async function resolveMediaFile({ directory, baseName, contentTypes }) {
  for (const [contentType, extension] of Object.entries(contentTypes)) {
    const filePath = path.join(directory, `${baseName}${extension}`);
    try {
      await fsPromises.access(filePath);
      return { filePath, contentType };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return null;
}

function unsupportedMediaType(label) {
  return Object.assign(new Error(`Unsupported ${label} type`), {
    statusCode: 415,
    code: 'UNSUPPORTED_MEDIA_TYPE',
  });
}

module.exports = { resolveMediaFile, saveMediaStream, unsupportedMediaType };
