// Local, standalone emotion analysis for a completed capture session
// (spec/feature/emotion-capture-companion.md §分析): session audio → local
// whisper STT → sentiment-core affect per utterance, persisted onto the
// capture-session record with explicit provenance. Nothing leaves the machine.
const { scoreUtterance } = require('./affectMapping');

const ANALYSIS_SCHEMA_VERSION = 1;
const MAXIMUM_UTTERANCES = 500;

/** @implements SPEC-EMOTION-CAPTURE-COMPANION */
function analysisError(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

/** @implements SPEC-EMOTION-CAPTURE-COMPANION */
class CaptureAnalysisService {
  constructor({ captureSessionService, sttClient, wavConverter, now = () => new Date() }) {
    this.captureSessionService = captureSessionService;
    this.sttClient = sttClient;
    this.wavConverter = wavConverter;
    this.now = now;
  }

  /** @implements SPEC-EMOTION-CAPTURE-COMPANION */
  status() {
    return {
      stt: { configured: Boolean(this.sttClient.baseUrl) },
      ffmpeg: { command: this.wavConverter.ffmpegPath },
    };
  }

  /** @implements SPEC-EMOTION-CAPTURE-COMPANION */
  async analyze(context, sessionId) {
    const record = await this.captureSessionService.findRecord(context, sessionId);
    if (record.status !== 'completed') {
      throw analysisError(409, 'CAPTURE_SESSION_RECORDING', 'Stop the capture session before analysing it');
    }
    const media = await this.captureSessionService.resolveAudio(context, sessionId);
    if (!media) {
      throw analysisError(409, 'CAPTURE_AUDIO_MISSING', 'This session has no uploaded audio to analyse');
    }
    // Without the recording start offset the transcript cannot be placed on
    // the session clock; refusing beats silently mis-anchoring every utterance.
    const audioStartSessionMs = record.capture.audioStartSessionMs;
    if (!Number.isFinite(audioStartSessionMs)) {
      throw analysisError(
        409,
        'CAPTURE_AUDIO_UNANCHORED',
        'The audio upload did not carry its session-clock start; re-record with an updated companion'
      );
    }

    const segments = await this.wavConverter.withWav(
      media.filePath,
      (wavPath) => this.sttClient.transcribeWavFile(wavPath)
    );
    const utterances = segments.slice(0, MAXIMUM_UTTERANCES).map((segment) => ({
      sessionMs: audioStartSessionMs + segment.startMs,
      endSessionMs: audioStartSessionMs + segment.endMs,
      text: segment.text,
      ...scoreUtterance(segment.text),
    }));

    const analysis = {
      schemaVersion: ANALYSIS_SCHEMA_VERSION,
      // Provenance in the persona-engine-v2 §4.4 style: this is derived data,
      // and the deterministic extractor pair is named explicitly.
      extractor: 'whisper-stt+sentiment-lexicon',
      analyzedAt: this.now().toISOString(),
      utteranceCount: utterances.length,
      droppedSegments: Math.max(segments.length - utterances.length, 0),
      utterances,
    };
    return this.captureSessionService.saveAnalysis(context, sessionId, analysis);
  }
}

module.exports = { ANALYSIS_SCHEMA_VERSION, CaptureAnalysisService };
