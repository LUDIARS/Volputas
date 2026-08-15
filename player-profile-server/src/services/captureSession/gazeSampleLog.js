// Append-only JSONL storage for gaze samples. Samples arrive in bursts (tens
// per second) for the whole session, so they are appended to one file per
// session instead of rewriting a JSON document per batch. The file lives in the
// same media layout as other profile media (media/<name>/capture-gaze/), but is
// deliberately not part of the evidence-media registry — see
// spec/feature/emotion-capture-companion.md.
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { assertSafeSegment, collectionDirectory, insideRepository } = require('../profileDataPaths');

const GAZE_MEDIA_KIND = 'capture-gaze';
// Lines per write() call when replacing a whole log (30 Hz over an hour is
// ~100k samples; writing one line per call would be needlessly slow).
const WRITE_CHUNK_LINES = 2000;

class GazeSampleLog {
  filePath({ repositoryRoot, name, sessionId }) {
    assertSafeSegment(sessionId, 'Session ID');
    const directory = insideRepository(
      collectionDirectory(repositoryRoot, 'media', name),
      GAZE_MEDIA_KIND
    );
    return insideRepository(directory, `${sessionId}.jsonl`);
  }

  async append(context, samples) {
    const filePath = this.filePath(context);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const lines = samples.map((sample) => `${JSON.stringify(sample)}\n`).join('');
    await fs.appendFile(filePath, lines, 'utf8');
    return { filePath, appended: samples.length };
  }

  // Whole-file replacement for post-hoc estimation. Accepts sync or async
  // iterables so a route can stream-parse an NDJSON upload. Written to a temporary
  // sibling and renamed so a failed write leaves the previous log intact.
  async replace(context, samples) {
    const filePath = this.filePath(context);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    let written = 0;
    try {
      const handle = await fs.open(temporaryPath, 'wx');
      try {
        let chunk = [];
        for await (const sample of samples) {
          chunk.push(JSON.stringify(sample));
          written += 1;
          if (chunk.length >= WRITE_CHUNK_LINES) {
            await handle.write(`${chunk.join('\n')}\n`, null, 'utf8');
            chunk = [];
          }
        }
        if (chunk.length > 0) await handle.write(`${chunk.join('\n')}\n`, null, 'utf8');
      } finally {
        await handle.close();
      }
      if (written === 0) {
        throw Object.assign(new Error('Gaze upload must contain at least one sample'), {
          statusCode: 400,
          code: 'INVALID_CAPTURE_INPUT',
        });
      }
      await fs.rename(temporaryPath, filePath);
      return { filePath, written };
    } catch (error) {
      await fs.unlink(temporaryPath).catch(() => {});
      throw error;
    }
  }

  async read(context) {
    let raw;
    try {
      raw = await fs.readFile(this.filePath(context), 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    return raw
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line, index) => {
        try {
          return JSON.parse(line);
        } catch (error) {
          throw Object.assign(
            new Error(`Gaze sample log line ${index + 1} is not valid JSON`),
            { code: 'INVALID_GAZE_LOG' }
          );
        }
      });
  }
}

module.exports = { GAZE_MEDIA_KIND, GazeSampleLog };
