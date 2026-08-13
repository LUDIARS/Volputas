// Append-only JSONL storage for gaze samples. Samples arrive in bursts (tens
// per second) for the whole session, so they are appended to one file per
// session instead of rewriting a JSON document per batch. The file lives in the
// same media layout as other profile media (media/<name>/capture-gaze/), but is
// deliberately not part of the evidence-media registry — see
// spec/feature/emotion-capture-companion.md.
const fs = require('node:fs/promises');
const path = require('node:path');
const { assertSafeSegment, collectionDirectory, insideRepository } = require('../profileDataPaths');

const GAZE_MEDIA_KIND = 'capture-gaze';

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
