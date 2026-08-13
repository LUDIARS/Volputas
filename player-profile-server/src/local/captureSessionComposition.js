// Default capture-session service composition for local mode. Keeping concrete
// stores here leaves localApp responsible only for HTTP application wiring.
const { ProfileRecordStore } = require('./profileRecordStore');
const { CapturePairing } = require('../services/captureSession/capturePairing');
const { CaptureAudioStore } = require('../services/captureSession/captureAudioStore');
const { CaptureSessionService } = require('../services/captureSession/captureSessionService');
const { GazeSampleLog } = require('../services/captureSession/gazeSampleLog');
const { CaptureAnalysisService } = require('../services/captureAnalysis/captureAnalysisService');
const { WhisperSttClient } = require('../services/captureAnalysis/sttClient');
const { AudioToWavConverter } = require('../services/captureAnalysis/audioToWav');

function createCaptureSessionService() {
  return new CaptureSessionService({
    recordStore: new ProfileRecordStore('capture-sessions'),
    gazeLog: new GazeSampleLog(),
    audioStore: new CaptureAudioStore(),
    pairing: new CapturePairing(),
  });
}

// Fully local analysis chain: the whisper-stt endpoint comes from the
// environment (the Excubitor catalog owns the port); ffmpeg from PATH unless
// overridden.
/** @implements SPEC-EMOTION-CAPTURE-COMPANION */
function createCaptureAnalysisService(captureSessionService, env = process.env) {
  return new CaptureAnalysisService({
    captureSessionService,
    sttClient: new WhisperSttClient({ baseUrl: env.VOLPUTAS_STT_URL || '' }),
    wavConverter: new AudioToWavConverter({ ffmpegPath: env.VOLPUTAS_FFMPEG || 'ffmpeg' }),
  });
}

module.exports = { createCaptureAnalysisService, createCaptureSessionService };
