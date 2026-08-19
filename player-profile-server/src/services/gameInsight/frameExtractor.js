// Cuts single JPEG frames out of a screen recording with the ffmpeg CLI
// (spec/feature/game-insight.md §改善提案 4). Same spawn discipline as
// captureAnalysis/audioToWav: no shell, array args, temporary files removed
// after the consumer settles. A missing ffmpeg is reported as a structured
// error so the caller can continue without frames.
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const FRAME_WIDTH = 960;
const DEFAULT_TIMEOUT_MS = 60 * 1000;

/** @implements SPEC-GAME-INSIGHT */
function frameError(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

/** @implements SPEC-GAME-INSIGHT */
class FrameExtractor {
  constructor({
    ffmpegPath = 'ffmpeg',
    spawnImpl = spawn,
    temporaryDirectory = os.tmpdir(),
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = {}) {
    this.ffmpegPath = ffmpegPath;
    this.spawnImpl = spawnImpl;
    this.temporaryDirectory = temporaryDirectory;
    this.timeoutMs = timeoutMs;
  }

  runFfmpeg(args) {
    return new Promise((resolve, reject) => {
      const child = this.spawnImpl(this.ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderrTail = '';
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve();
      };
      const timer = setTimeout(() => {
        finish(frameError(504, 'FRAME_EXTRACTION_TIMEOUT',
          `ffmpeg frame extraction timed out after ${this.timeoutMs}ms`));
        try { child.kill(); } catch { /* process may already be gone; best-effort */ }
      }, this.timeoutMs);
      child.stderr?.on('data', (chunk) => { stderrTail = `${stderrTail}${chunk}`.slice(-2000); });
      child.on('error', (error) => {
        if (error.code === 'ENOENT') {
          finish(frameError(503, 'FFMPEG_NOT_AVAILABLE',
            `ffmpeg was not found (${this.ffmpegPath}); install it or set VOLPUTAS_FFMPEG`));
          return;
        }
        finish(frameError(500, 'FFMPEG_SPAWN_FAILED', error.message));
      });
      child.on('close', (exitCode) => {
        if (exitCode === 0) { finish(); return; }
        finish(frameError(422, 'FRAME_EXTRACTION_FAILED',
          `ffmpeg exited with ${exitCode}: ${stderrTail.split('\n').slice(-3).join(' ').trim()}`));
      });
    });
  }

  /**
   * Extracts one frame per `seconds` entry and hands `[{ seconds, filePath }]`
   * to `use`; the whole temporary directory is removed afterwards. Entries
   * whose extraction fails are skipped (reported in the returned `skipped`).
   */
  async withFrames(videoPath, secondsList, use) {
    const directory = path.join(this.temporaryDirectory, `volputas-frames-${randomUUID()}`);
    await fs.mkdir(directory, { recursive: true });
    try {
      const frames = [];
      const skipped = [];
      for (const [index, seconds] of secondsList.entries()) {
        const filePath = path.join(directory, `frame-${String(index + 1).padStart(2, '0')}.jpg`);
        try {
          await this.runFfmpeg([
            '-hide_banner', '-nostdin', '-y',
            '-ss', String(Math.max(0, seconds)),
            '-i', videoPath,
            '-frames:v', '1',
            '-vf', `scale=${FRAME_WIDTH}:-2`,
            '-q:v', '4',
            filePath,
          ]);
          frames.push({ seconds, filePath });
        } catch (error) {
          if (error.code === 'FFMPEG_NOT_AVAILABLE') throw error;
          skipped.push({ seconds, reason: error.message });
        }
      }
      return await use({ frames, skipped });
    } finally {
      await fs.rm(directory, { recursive: true, force: true }).catch(() => { /* best effort */ });
    }
  }
}

module.exports = { DEFAULT_TIMEOUT_MS, FRAME_WIDTH, FrameExtractor };
