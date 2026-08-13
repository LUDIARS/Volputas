// HTTP client for a local whisper.cpp-compatible STT server (the shared
// LocalServices/whisper-stt instance; POST /inference, multipart WAV). The
// endpoint comes from configuration — ports are owned by the Excubitor catalog,
// so an unset URL is a hard NOT_CONFIGURED error, never a hardcoded default
// (§7.1: no silent stub).
const fs = require('node:fs/promises');

/** @implements SPEC-EMOTION-CAPTURE-COMPANION */
function sttError(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

/** @implements SPEC-EMOTION-CAPTURE-COMPANION */
function isLoopbackHostname(hostname) {
  return hostname === 'localhost'
    || hostname === '::1'
    || hostname === '[::1]'
    || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

/** @implements SPEC-EMOTION-CAPTURE-COMPANION */
class WhisperSttClient {
  constructor({ baseUrl, language = 'ja', fetchImpl = fetch } = {}) {
    this.baseUrl = (baseUrl || '').replace(/\/$/, '');
    this.language = language;
    this.fetchImpl = fetchImpl;
  }

  /** @implements SPEC-EMOTION-CAPTURE-COMPANION */
  assertConfigured() {
    if (!this.baseUrl) {
      throw sttError(
        503,
        'STT_NOT_CONFIGURED',
        'Set VOLPUTAS_STT_URL to the local whisper server (see the Excubitor catalog) to enable transcription'
      );
    }
    let url;
    try {
      url = new URL(this.baseUrl);
    } catch {
      throw sttError(503, 'STT_URL_INVALID', 'VOLPUTAS_STT_URL must be a valid local HTTP URL');
    }
    if (
      !['http:', 'https:'].includes(url.protocol)
      || url.username
      || url.password
      || !isLoopbackHostname(url.hostname)
    ) {
      throw sttError(
        503,
        'STT_URL_INVALID',
        'VOLPUTAS_STT_URL must point to a loopback HTTP server without credentials'
      );
    }
  }

  // whisper.cpp が [BGM] (拍手) のような非発話注記を付けるため落とす。
  /** @implements SPEC-EMOTION-CAPTURE-COMPANION */
  normalize(text) {
    return String(text || '').replace(/\[.*?\]|\(.*?\)/g, '').trim();
  }

  /**
   * Transcribes a 16kHz mono WAV file. Returns utterance segments with
   * millisecond offsets relative to the start of the audio. Servers that do
   * not support verbose_json fall back to one whole-file segment.
   */
  /** @implements SPEC-EMOTION-CAPTURE-COMPANION */
  async transcribeWavFile(wavPath) {
    this.assertConfigured();
    const bytes = await fs.readFile(wavPath);
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: 'audio/wav' }), 'capture.wav');
    form.append('response_format', 'verbose_json');
    form.append('language', this.language);
    form.append('temperature', '0.0');

    const response = await this.fetchImpl(`${this.baseUrl}/inference`, {
      method: 'POST',
      body: form,
      // Audio must remain local even if a compromised STT service answers with
      // a redirect to a non-loopback address.
      redirect: 'error',
    });
    if (!response.ok) {
      throw sttError(502, 'STT_REQUEST_FAILED', `STT server responded with HTTP ${response.status}`);
    }
    const data = await response.json();
    if (data && Array.isArray(data.segments)) {
      return data.segments
        .map((segment) => {
          if (!segment || typeof segment !== 'object') {
            throw sttError(502, 'STT_RESPONSE_INVALID', 'STT response contained an invalid segment');
          }
          const usesWhisperTicks = segment.start === undefined && segment.t0 !== undefined;
          const start = Number(segment.start ?? segment.t0 ?? 0);
          const end = Number(segment.end ?? segment.t1 ?? 0);
          if (
            !Number.isFinite(start)
            || !Number.isFinite(end)
            || start < 0
            || end < start
          ) {
            throw sttError(502, 'STT_RESPONSE_INVALID', 'STT response contained an invalid segment time');
          }
          // OpenAI-style verbose JSON uses seconds, while whisper.cpp's t0/t1
          // fields are 10 ms ticks. Treating the latter as seconds shifts a
          // short clip by orders of magnitude on the session timeline.
          const millisecondsPerUnit = usesWhisperTicks ? 10 : 1000;
          return {
            startMs: Math.round(start * millisecondsPerUnit),
            endMs: Math.round(end * millisecondsPerUnit),
            text: this.normalize(segment.text),
          };
        })
        .filter((segment) => segment.text.length > 0);
    }
    if (data && typeof data.text === 'string') {
      const text = this.normalize(data.text);
      return text ? [{ startMs: 0, endMs: 0, text }] : [];
    }
    throw sttError(502, 'STT_RESPONSE_INVALID', 'STT response carried neither segments nor text');
  }
}

module.exports = { WhisperSttClient };
