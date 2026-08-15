// Desktop-side capture helpers for the emotion capture page
// (spec/feature/emotion-capture-companion.md §デスクトップキャプチャ): MIME
// selection, session-clock bookkeeping and upload headers are pure and unit
// tested; TrackRecorder is the thin MediaRecorder wrapper the page drives.

export const VIDEO_MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9',
  'video/webm',
  'video/mp4',
];

export const AUDIO_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
];

// Bounds mirror the server stores (captureAudioStore / captureVideoStore).
export const AUDIO_MAX_BYTES = 500 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 8 * 1024 * 1024 * 1024;

export function pickMimeType(candidates, MediaRecorderType) {
  if (!MediaRecorderType || typeof MediaRecorderType.isTypeSupported !== 'function') return '';
  return candidates.find((type) => MediaRecorderType.isTypeSupported(type)) || '';
}

export function baseMimeType(mimeType) {
  return String(mimeType || '').split(';')[0].trim();
}

// The desktop UI runs on the same machine as the local server, so its wall
// clock and the server's agree; sessionMs is simply now − startedAt.
export function sessionClockMs(startedAtIso, nowMs = Date.now()) {
  return Math.max(nowMs - Date.parse(startedAtIso), 0);
}

export function recordingHeaders({ contentType, startSessionMs, durationSeconds, width, height }) {
  const headers = {
    'content-type': contentType,
    'x-capture-start-session-ms': String(Math.round(startSessionMs)),
  };
  if (Number.isFinite(durationSeconds)) headers['x-capture-duration-seconds'] = String(durationSeconds);
  if (Number.isFinite(width) && width > 0) headers['x-capture-width'] = String(Math.round(width));
  if (Number.isFinite(height) && height > 0) headers['x-capture-height'] = String(Math.round(height));
  return headers;
}

export function audioHeaders({ contentType, startSessionMs, durationSeconds }) {
  const headers = {
    'content-type': contentType,
    'x-audio-start-session-ms': String(Math.round(startSessionMs)),
  };
  if (Number.isFinite(durationSeconds)) headers['x-audio-duration-seconds'] = String(durationSeconds);
  return headers;
}

export function assertBlobWithinLimit(blob, maximumBytes, label) {
  if (!blob || blob.size === 0) throw new Error(`${label}が空です。`);
  if (blob.size > maximumBytes) {
    throw new Error(`${label}が上限 (${Math.round(maximumBytes / 1024 / 1024)}MB) を超えています。`);
  }
  return blob;
}

// Wraps one MediaRecorder. start() resolves once recording actually began and
// notes the session clock at that instant; stop() resolves with the blob and
// the recording's placement on the session clock.
export class TrackRecorder {
  constructor({ stream, mimeType, MediaRecorderType = globalThis.MediaRecorder, sessionClock, timesliceMs = 5000 }) {
    this.stream = stream;
    this.mimeType = mimeType;
    this.MediaRecorderType = MediaRecorderType;
    this.sessionClock = sessionClock;
    this.timesliceMs = timesliceMs;
    this.chunks = [];
    this.recorder = null;
    this.startSessionMs = null;
    this.stopSessionMs = null;
    this.stopPromise = null;
    this.stopResolve = null;
    this.stopReject = null;
    this.stopped = false;
    this.recordingError = null;
  }

  start() {
    return new Promise((resolve, reject) => {
      const recorder = new this.MediaRecorderType(this.stream, this.mimeType ? { mimeType: this.mimeType } : undefined);
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) this.chunks.push(event.data);
      };
      recorder.onstart = () => {
        this.startSessionMs = this.sessionClock();
        resolve(this.startSessionMs);
      };
      recorder.onstop = () => {
        this.stopSessionMs = this.sessionClock();
        this.stopped = true;
        this.stopResolve?.(this.result());
      };
      recorder.onerror = (event) => {
        const error = event.error || new Error('録画に失敗しました。');
        this.recordingError = error;
        reject(error);
        this.stopReject?.(error);
      };
      this.recorder = recorder;
      // Timeslice makes long recordings resilient: data is flushed periodically
      // instead of living in one giant in-memory chunk until stop.
      recorder.start(this.timesliceMs);
    });
  }

  get active() {
    return Boolean(this.recorder) && this.recorder.state !== 'inactive';
  }

  stop() {
    // MediaRecorder changes to `inactive` before its final dataavailable/stop
    // callbacks run. Keep one promise so a second caller (for example session
    // finish immediately after "Stop sharing") waits for that final chunk
    // instead of observing an incomplete blob.
    if (this.stopPromise) return this.stopPromise;
    const { recorder } = this;
    if (!recorder || this.stopped) return Promise.resolve(this.result());
    this.stopPromise = new Promise((resolve, reject) => {
      this.stopResolve = resolve;
      this.stopReject = reject;
      if (this.recordingError) {
        reject(this.recordingError);
        return;
      }
      // `inactive` can mean the browser has begun its automatic stop after a
      // source track ended. The onstop handler installed at start will settle
      // this promise after the final dataavailable event in that case.
      if (recorder.state !== 'inactive') recorder.stop();
    });
    return this.stopPromise;
  }

  result() {
    const type = this.recorder?.mimeType || this.mimeType || '';
    const blob = new Blob(this.chunks, { type });
    const durationSeconds = this.startSessionMs === null || this.stopSessionMs === null
      ? null
      : Math.max((this.stopSessionMs - this.startSessionMs) / 1000, 0);
    return {
      blob,
      contentType: baseMimeType(type),
      startSessionMs: this.startSessionMs ?? 0,
      durationSeconds,
    };
  }
}
