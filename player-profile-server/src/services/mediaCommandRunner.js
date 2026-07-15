const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { ProcessingError } = require('./processingError');

const execute = promisify(execFile);

class MediaCommandRunner {
  constructor({ ffmpegPath, ffprobePath, antivirusPath }) {
    this.ffmpegPath = ffmpegPath;
    this.ffprobePath = ffprobePath;
    this.antivirusPath = antivirusPath;
  }

  async verifyCapabilities() {
    await execute(this.ffmpegPath, ['-version'], { windowsHide: true });
    await execute(this.ffprobePath, ['-version'], { windowsHide: true });
    await execute(this.antivirusPath, ['--version'], { windowsHide: true });
  }

  async scan(path) {
    try {
      await execute(this.antivirusPath, ['--no-summary', path], { windowsHide: true });
    } catch (error) {
      if (error.code === 1) throw new ProcessingError('Malware scan rejected the media file.', true);
      throw new ProcessingError(`Malware scanner failed: ${error.message}`, false);
    }
  }

  async probe(path) {
    try {
      const { stdout } = await execute(this.ffprobePath, [
        '-v', 'error', '-show_streams', '-show_format', '-of', 'json', path,
      ], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
      return JSON.parse(stdout);
    } catch (error) {
      throw new ProcessingError(`Media decoder rejected the file: ${error.message}`, true);
    }
  }

  async sanitizeImage(input, output, thumbnail) {
    await this.runFfmpeg([
      '-nostdin', '-y', '-v', 'error', '-i', input, '-map', '0:v:0',
      '-map_metadata', '-1', '-frames:v', '1', output,
    ]);
    await this.runFfmpeg([
      '-nostdin', '-y', '-v', 'error', '-i', output, '-map', '0:v:0', '-map_metadata', '-1',
      '-vf', 'scale=480:-2:force_original_aspect_ratio=decrease', '-frames:v', '1', thumbnail,
    ]);
  }

  async transcodeVideo(input, output, maximumDurationMs) {
    if (!Number.isSafeInteger(maximumDurationMs) || maximumDurationMs <= 0) {
      throw new ProcessingError('Video conversion duration limit is invalid.', true);
    }
    await this.runFfmpeg([
      '-nostdin', '-y', '-v', 'error', '-i', input, '-map_metadata', '-1',
      '-t', String(maximumDurationMs / 1000),
      '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', output,
    ]);
  }

  async runFfmpeg(argumentsList) {
    try {
      await execute(this.ffmpegPath, argumentsList, { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    } catch (error) {
      throw new ProcessingError(`Media conversion failed: ${error.message}`, true);
    }
  }
}

module.exports = { MediaCommandRunner };
