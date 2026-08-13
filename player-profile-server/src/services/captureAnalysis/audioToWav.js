// Converts a captured session audio file (webm/m4a/…) to the 16kHz mono WAV
// the whisper server expects, via the ffmpeg CLI. No shell, args as an array,
// temp output cleaned up on every failure path (§10 resource lifetime).
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

/** @implements SPEC-EMOTION-CAPTURE-COMPANION */
function conversionError(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

/** @implements SPEC-EMOTION-CAPTURE-COMPANION */
class AudioToWavConverter {
  constructor({ ffmpegPath = 'ffmpeg', spawnImpl = spawn, temporaryDirectory = os.tmpdir() } = {}) {
    this.ffmpegPath = ffmpegPath;
    this.spawnImpl = spawnImpl;
    this.temporaryDirectory = temporaryDirectory;
  }

  /** @implements SPEC-EMOTION-CAPTURE-COMPANION */
  runFfmpeg(args) {
    return new Promise((resolve, reject) => {
      const child = this.spawnImpl(this.ffmpegPath, args, {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderrTail = '';
      child.stderr?.on('data', (chunk) => {
        // Keep only the tail: ffmpeg logs its whole config banner on stderr.
        stderrTail = `${stderrTail}${chunk}`.slice(-2000);
      });
      child.on('error', (error) => {
        if (error.code === 'ENOENT') {
          reject(conversionError(
            503,
            'FFMPEG_NOT_AVAILABLE',
            `ffmpeg was not found (${this.ffmpegPath}); install it or set VOLPUTAS_FFMPEG`
          ));
          return;
        }
        reject(conversionError(500, 'FFMPEG_SPAWN_FAILED', error.message));
      });
      child.on('close', (exitCode) => {
        if (exitCode === 0) {
          resolve();
          return;
        }
        reject(conversionError(
          422,
          'AUDIO_CONVERSION_FAILED',
          `ffmpeg exited with ${exitCode}: ${stderrTail.split('\n').slice(-3).join(' ').trim()}`
        ));
      });
    });
  }

  /**
   * Converts inputPath and hands the temporary WAV to `use`; the WAV is
   * removed after `use` settles so callers cannot leak it.
   */
  /** @implements SPEC-EMOTION-CAPTURE-COMPANION */
  async withWav(inputPath, use) {
    const wavPath = path.join(this.temporaryDirectory, `volputas-capture-${randomUUID()}.wav`);
    try {
      await this.runFfmpeg([
        '-hide_banner', '-nostdin', '-y',
        '-i', inputPath,
        '-vn', '-ac', '1', '-ar', '16000', '-f', 'wav',
        wavPath,
      ]);
      return await use(wavPath);
    } finally {
      await fs.unlink(wavPath).catch(() => { /* not created on conversion failure */ });
    }
  }
}

module.exports = { AudioToWavConverter };
