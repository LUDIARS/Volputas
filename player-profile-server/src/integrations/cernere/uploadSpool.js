const { openAsBlob, createWriteStream } = require('node:fs');
const { mkdtemp, mkdir, rename, rmdir, unlink } = require('node:fs/promises');
const { dirname, isAbsolute, join, resolve } = require('node:path');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const MAXIMUM_BYTES = 2 * 1024 ** 3;
const TOTAL_BYTES = 4 * 1024 ** 3;
const MAXIMUM_LEASES = 8;

function invalid(message, code = 'INVALID_UPLOAD_CAPTURE') {
  return Object.assign(new Error(message), { code });
}

/** Owns bounded private files until rejection or a single atomic adoption.
 * @implements SPEC-GLAB-SCOPED-EVIDENCE-UPLOAD
 */
class UploadSpool {
  constructor(root) {
    if (!isAbsolute(root) || /^[/\\]{2}/.test(root)) throw invalid('Private spool requires a local absolute root');
    this.root = resolve(root);
    this.bytes = 0;
    this.leases = 0;
  }

  async capture(stream, limits) {
    const { maximumBytes, byteLength, timeoutSeconds, expiresAt, signal } = limits;
    const deadline = Date.parse(expiresAt);
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > MAXIMUM_BYTES
      || !Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > maximumBytes
      || !Number.isSafeInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 300
      || !Number.isFinite(deadline) || deadline <= Date.now() || deadline > Date.now() + timeoutSeconds * 1000
      || !signal || signal.aborted) throw invalid('Invalid reserved upload bounds');
    if (this.leases >= MAXIMUM_LEASES || this.bytes + byteLength > TOTAL_BYTES) {
      throw invalid('Private spool capacity unavailable', 'UPLOAD_CAPACITY_UNAVAILABLE');
    }
    this.leases++; this.bytes += byteLength;
    let directory, file, cleanup, adoption, moved = false, length = 0;
    const dispose = () => cleanup ??= (async () => {
      if (adoption) await adoption.catch(() => { /* Failed rename leaves the owned spool file for cleanup. */ });
      if (file && !moved) await unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
      if (directory) await rmdir(directory).catch(error => { if (error.code !== 'ENOENT') throw error; });
      // A failed unlink keeps its capacity charged: orphan bytes cannot make
      // later requests exceed the private quota. The failure remains visible.
      this.bytes -= byteLength; this.leases--;
    })();
    const controller = new AbortController();
    const ownedSignal = AbortSignal.any([signal, controller.signal]);
    const current = () => { if (ownedSignal.aborted || Date.now() >= deadline) throw invalid('Upload owner ended', 'UPLOAD_EXPIRED'); };
    const timer = setTimeout(() => controller.abort(), Math.max(1, deadline - Date.now()));
    timer.unref?.();
    try {
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      directory = await mkdtemp(join(this.root, 'arrival-'));
      if (dirname(directory) !== this.root) throw invalid('Unexpected private spool path');
      file = join(directory, 'body');
      const limiter = new Transform({ transform(chunk, _encoding, callback) {
        try {
          current(); length += chunk.length;
          if (length > byteLength || length > maximumBytes) throw invalid('Upload exceeds its reserved size', 'MEDIA_TOO_LARGE');
          callback(null, chunk);
        } catch (error) { callback(error); }
      } });
      // Pipeline awaits closure of both Node streams on success and failure.
      await pipeline(stream, limiter, createWriteStream(file, { flags: 'wx', mode: 0o600 }), { signal: ownedSignal });
      current();
      if (length !== byteLength) throw invalid('Upload size differs from reservation');
      const body = await openAsBlob(file);
      if (body.size !== byteLength) throw invalid('Captured file size changed');
      return {
        body, dispose,
        adopt(destination) {
          current();
          if (adoption || cleanup || !isAbsolute(destination)) throw invalid('Capture cannot be adopted');
          // destination comes only from ProfileMediaStore validated paths.
          adoption = rename(file, destination).then(() => { moved = true; });
          return adoption;
        },
      };
    } catch (error) { await dispose(); throw error; }
    finally { clearTimeout(timer); }
  }
}

module.exports = { UploadSpool };
