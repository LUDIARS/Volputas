// Default capture-session service composition for local mode. Keeping concrete
// stores here leaves localApp responsible only for HTTP application wiring.
const { ProfileRecordStore } = require('./profileRecordStore');
const { CapturePairing } = require('../services/captureSession/capturePairing');
const { CaptureAudioStore } = require('../services/captureSession/captureAudioStore');
const { CaptureSessionService } = require('../services/captureSession/captureSessionService');
const { GazeSampleLog } = require('../services/captureSession/gazeSampleLog');

function createCaptureSessionService() {
  return new CaptureSessionService({
    recordStore: new ProfileRecordStore('capture-sessions'),
    gazeLog: new GazeSampleLog(),
    audioStore: new CaptureAudioStore(),
    pairing: new CapturePairing(),
  });
}

module.exports = { createCaptureSessionService };
