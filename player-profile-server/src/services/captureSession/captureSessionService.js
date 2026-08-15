// Lifecycle owner for emotion-capture sessions
// (spec/feature/emotion-capture-companion.md). One session records at a time;
// the game (or the desktop UI) starts and stops it, companions attach gaze and
// audio through pairing tokens. Persistence goes through the shared
// ProfileRecordStore layout so sessions live in the local data repository next
// to the other profile records.
const { buildTimeline } = require('./captureTimeline');

// Contexts for recently finished sessions are retained so the phone can still
// upload its audio after the stop signal; the bound is a leak guard, not a
// feature limit.
const RETAINED_FINISHED_SESSIONS = 8;

function captureError(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

class CaptureSessionService {
  constructor({ recordStore, gazeLog, audioStore, videoStore, pairing, now = () => new Date() }) {
    this.recordStore = recordStore;
    this.gazeLog = gazeLog;
    this.audioStore = audioStore;
    this.videoStore = videoStore;
    this.pairing = pairing;
    this.now = now;
    this.activeSession = null; // { record, context }
    this.finishedSessions = new Map(); // sessionId -> { record, context }
    this.mutationQueue = Promise.resolve();
    this.initializedContexts = new Set();
    this.contextInitializations = new Map();
    this.uploadsInFlight = new Set(); // audio: sessionId, video: `${sessionId}:${kind}`
  }

  currentSessionMs(record) {
    return Math.max(this.now().getTime() - Date.parse(record.startedAt), 0);
  }

  enqueueMutation(operation) {
    const result = this.mutationQueue.then(operation);
    // Keep later mutations usable after a rejected request while returning the
    // original rejection to that request's caller.
    this.mutationQueue = result.catch(() => {});
    return result;
  }

  contextKey(context) {
    return JSON.stringify([context.repositoryRoot, context.name]);
  }

  async initialize(context) {
    const key = this.contextKey(context);
    if (this.initializedContexts.has(key)) return;
    let initialization = this.contextInitializations.get(key);
    if (!initialization) {
      initialization = (async () => {
        const records = await this.recordStore.list(context);
        for (const record of records.filter((item) => item.status === 'recording')) {
          const gazeSamples = await this.gazeLog.read({
            ...context,
            sessionId: record.id,
          });
          await this.recordStore.write({
            ...context,
            data: {
              ...record,
              status: 'interrupted',
              endedAt: null,
              capture: { ...record.capture, gazeSampleCount: gazeSamples.length },
            },
          });
        }
        this.initializedContexts.add(key);
      })();
      this.contextInitializations.set(key, initialization);
    }
    try {
      await initialization;
    } finally {
      if (this.contextInitializations.get(key) === initialization) {
        this.contextInitializations.delete(key);
      }
    }
  }

  async active(context) {
    if (context) await this.initialize(context);
    return this.activeSession ? this.activeSession.record : null;
  }

  async list(context) {
    await this.initialize(context);
    return this.recordStore.list(context);
  }

  async start(context, input, source) {
    return this.enqueueMutation(async () => {
      await this.initialize(context);
      return this.startNow(context, input, source);
    });
  }

  async startNow(context, input, source) {
    if (this.activeSession) {
      throw captureError(
        409,
        'CAPTURE_SESSION_ACTIVE',
        `A capture session is already recording (${this.activeSession.record.gameTitle})`
      );
    }
    const startedAt = this.now().toISOString();
    const anchors = input.gameClockMs === null || input.gameClockMs === undefined
      ? []
      : [{ sessionMs: 0, gameClockMs: input.gameClockMs }];
    const { record } = await this.recordStore.write({
      ...context,
      data: {
        gameTitle: input.gameTitle,
        source,
        status: 'recording',
        startedAt,
        endedAt: null,
        anchors,
        markers: [],
        devices: [],
        capture: {
          gazeSampleCount: 0,
          // 'companion' = live samples from a paired device, 'face-video' =
          // post-hoc estimation over the face recording (§視線推定).
          gazeSource: null,
          audioFileName: null,
          audioDurationSeconds: null,
          audioStartSessionMs: null,
          screenRecording: null,
          faceRecording: null,
        },
        calibration: null,
      },
    });
    this.activeSession = { record, context };
    this.pairing.revokeOtherSessions(record.id);
    return record;
  }

  requireActive() {
    if (!this.activeSession) {
      throw captureError(409, 'NO_ACTIVE_SESSION', 'No capture session is recording');
    }
    return this.activeSession;
  }

  async addMarker(origin, input) {
    return this.enqueueMutation(() => this.addMarkerNow(origin, input));
  }

  async addMarkerNow(origin, input) {
    const { record, context } = this.requireActive();
    const sessionMs = input.sessionMs === null || input.sessionMs === undefined
      ? this.currentSessionMs(record)
      : input.sessionMs;
    const marker = { sessionMs, origin, type: input.type, label: input.label || '' };
    const anchor = input.gameClockMs === null || input.gameClockMs === undefined
      ? []
      : [{ sessionMs, gameClockMs: input.gameClockMs }];
    const updated = {
      ...record,
      markers: [...record.markers, marker],
      anchors: [...record.anchors, ...anchor],
    };
    const { record: persisted } = await this.recordStore.write({ ...context, data: updated });
    this.activeSession.record = persisted;
    return persisted;
  }

  async stop(input = {}) {
    return this.enqueueMutation(() => this.stopNow(input));
  }

  async stopNow(input = {}) {
    const { record, context } = this.requireActive();
    const sessionMs = this.currentSessionMs(record);
    const anchor = input.gameClockMs === null || input.gameClockMs === undefined
      ? []
      : [{ sessionMs, gameClockMs: input.gameClockMs }];
    const updated = {
      ...record,
      status: 'completed',
      endedAt: this.now().toISOString(),
      anchors: [...record.anchors, ...anchor],
    };
    const { record: persisted } = await this.recordStore.write({ ...context, data: updated });
    this.pairing.finishSession(persisted.id);
    this.activeSession = null;
    this.finishedSessions.set(persisted.id, { record: persisted, context });
    while (this.finishedSessions.size > RETAINED_FINISHED_SESSIONS) {
      const oldest = this.finishedSessions.keys().next().value;
      this.finishedSessions.delete(oldest);
    }
    return persisted;
  }

  async handleSignal(context, input) {
    if (input.action === 'start') return this.start(context, input, 'game-signal');
    await this.initialize(context);
    if (input.action === 'marker') return this.addMarker('game', input);
    return this.stop(input);
  }

  // ---- companion (token-authenticated) operations ----

  async issuePairing() {
    return this.enqueueMutation(() => {
      const { record } = this.requireActive();
      return this.pairing.issueCode(record.id);
    });
  }

  async join(code) {
    return this.enqueueMutation(async () => {
      const claimed = this.pairing.claim(code);
      try {
        const session = this.sessionById(claimed.sessionId);
        if (session !== this.activeSession) {
          throw captureError(409, 'CAPTURE_SESSION_STOPPED', 'Capture session has stopped');
        }
        const { record, context } = session;
        const updated = {
          ...record,
          devices: [...record.devices, {
            deviceId: claimed.deviceId,
            joinedSessionMs: this.currentSessionMs(record),
          }],
        };
        const { record: persisted } = await this.recordStore.write({ ...context, data: updated });
        session.record = persisted;
        return { ...claimed, record: persisted };
      } catch (error) {
        this.pairing.revokeToken(claimed.token);
        throw error;
      }
    });
  }

  sessionById(sessionId) {
    if (this.activeSession && this.activeSession.record.id === sessionId) {
      return this.activeSession;
    }
    const finished = this.finishedSessions.get(sessionId);
    if (!finished) {
      throw captureError(410, 'CAPTURE_SESSION_GONE', 'Capture session is no longer available');
    }
    return finished;
  }

  // Returns the canonical session holder (not a copy) so callers may update
  // holder.record after persisting.
  companionSession(token) {
    const { sessionId, deviceId } = this.pairing.verify(token);
    return { holder: this.sessionById(sessionId), deviceId };
  }

  companionState(token) {
    const { holder: { record } } = this.companionSession(token);
    return {
      id: record.id,
      gameTitle: record.gameTitle,
      status: record.status,
      sessionMs: record.status === 'recording' ? this.currentSessionMs(record) : null,
    };
  }

  sync(token, input) {
    const { holder: { record } } = this.companionSession(token);
    if (record.status !== 'recording') {
      throw captureError(409, 'CAPTURE_SESSION_STOPPED', 'Capture session has stopped');
    }
    return {
      sessionMs: this.currentSessionMs(record),
      serverEpochMs: this.now().getTime(),
      clientSentAtMs: input.clientSentAtMs,
    };
  }

  async ingestGaze(token, batch) {
    return this.enqueueMutation(async () => {
      const { holder } = this.companionSession(token);
      const { record, context } = holder;
      if (record.status !== 'recording') {
        throw captureError(409, 'CAPTURE_SESSION_STOPPED', 'Capture session has stopped');
      }
      await this.gazeLog.append({ ...context, sessionId: record.id }, batch.samples);
      // The running count is volatile by design: persisting the record on every
      // batch would rewrite the JSON file several times a second. The JSONL file
      // is the source of truth; the count is folded into the record at stop.
      const total = record.capture.gazeSampleCount + batch.samples.length;
      holder.record = {
        ...record,
        capture: { ...record.capture, gazeSampleCount: total, gazeSource: 'companion' },
      };
      return { accepted: batch.samples.length, total };
    });
  }

  async companionMarker(token, input) {
    return this.enqueueMutation(async () => {
      const { holder } = this.companionSession(token);
      if (this.activeSession !== holder) {
        throw captureError(409, 'CAPTURE_SESSION_STOPPED', 'Capture session has stopped');
      }
      return this.addMarkerNow('companion', input);
    });
  }

  async attachAudio(token, { contentType, stream, durationSeconds, startSessionMs }) {
    const { holder } = this.companionSession(token);
    return this.attachAudioTo(holder.record, holder.context, {
      contentType, stream, durationSeconds, startSessionMs,
    });
  }

  // Loopback variant for the desktop capture panel: the browser tab that
  // recorded the microphone uploads after stop, no pairing token involved.
  async attachAudioLocal(context, sessionId, input) {
    const record = await this.findRecord(context, sessionId);
    return this.attachAudioTo(record, context, input);
  }

  async attachAudioTo(record, context, { contentType, stream, durationSeconds, startSessionMs }) {
    if (record.status === 'recording') {
      throw captureError(409, 'CAPTURE_SESSION_RECORDING', 'Stop the capture session before uploading audio');
    }
    if (record.capture.audioFileName || this.uploadsInFlight.has(record.id)) {
      throw captureError(409, 'CAPTURE_AUDIO_EXISTS', 'Session audio has already been uploaded');
    }
    this.uploadsInFlight.add(record.id);
    try {
      const saved = await this.audioStore.save({
        ...context,
        sessionId: record.id,
        contentType,
        stream,
      });
      await this.patchRecord(context, record.id, (current) => ({
        ...current,
        capture: {
          ...current.capture,
          audioFileName: saved.fileName,
          audioDurationSeconds: durationSeconds,
          // Where on the session clock the recording began; the transcript
          // cannot be anchored without it (captureAnalysisService refuses to
          // guess).
          audioStartSessionMs: startSessionMs ?? null,
        },
      }));
      return { fileName: saved.fileName, bytes: saved.bytes };
    } finally {
      this.uploadsInFlight.delete(record.id);
    }
  }

  // Screen (gameplay) and face (player camera) recordings. Unlike audio these
  // may be re-uploaded: an external recorder file can replace an in-browser
  // capture, and the newer file simply wins.
  async attachVideo(context, sessionId, {
    kind, contentType, stream, startSessionMs, durationSeconds, width, height,
  }) {
    const record = await this.findRecord(context, sessionId);
    if (record.status === 'recording') {
      throw captureError(409, 'CAPTURE_SESSION_RECORDING', 'Stop the capture session before uploading recordings');
    }
    const uploadKey = `${record.id}:${kind}`;
    if (this.uploadsInFlight.has(uploadKey)) {
      throw captureError(409, 'CAPTURE_UPLOAD_IN_PROGRESS', 'This recording is already being uploaded');
    }
    this.uploadsInFlight.add(uploadKey);
    try {
      const saved = await this.videoStore.save({
        ...context, sessionId: record.id, kind, contentType, stream,
      });
      const field = `${kind}Recording`;
      await this.patchRecord(context, record.id, (current) => ({
        ...current,
        capture: {
          ...current.capture,
          [field]: {
            fileName: saved.fileName,
            contentType: saved.contentType,
            bytes: saved.bytes,
            startSessionMs,
            durationSeconds,
            width,
            height,
            uploadedAt: this.now().toISOString(),
          },
        },
      }));
      return { fileName: saved.fileName, bytes: saved.bytes };
    } finally {
      this.uploadsInFlight.delete(uploadKey);
    }
  }

  // Calibration windows are recorded while the face camera runs (usually right
  // after start), so this is allowed on the active session as well as on a
  // finished one whose calibration is being corrected.
  async saveCalibration(context, sessionId, input) {
    return this.patchRecord(context, sessionId, (current) => ({
      ...current,
      calibration: {
        schemaVersion: 1,
        recordedAt: this.now().toISOString(),
        screen: input.screen,
        points: input.points,
      },
    }));
  }

  // Post-hoc gaze estimation replaces whatever gaze log exists: the estimator
  // ran over the whole face recording, so partial merges would only mix
  // sources. Companion (live) samples are overwritten deliberately and the
  // record says so through gazeSource.
  async replaceGazeSamples(context, sessionId, { samples, estimation }) {
    const record = await this.findRecord(context, sessionId);
    if (record.status === 'recording') {
      throw captureError(409, 'CAPTURE_SESSION_RECORDING', 'Stop the capture session before replacing gaze samples');
    }
    const written = await this.gazeLog.replace({ ...context, sessionId }, samples);
    return this.patchRecord(context, sessionId, (current) => ({
      ...current,
      capture: {
        ...current.capture,
        gazeSampleCount: written.written,
        gazeSource: 'face-video',
      },
      gazeEstimation: {
        schemaVersion: 1,
        ...estimation,
        sampleCount: written.written,
        estimatedAt: this.now().toISOString(),
      },
    }));
  }

  // ---- read-side ----

  async findRecord(context, sessionId) {
    await this.initialize(context);
    if (this.activeSession && this.activeSession.record.id === sessionId) {
      return this.activeSession.record;
    }
    const records = await this.recordStore.list(context);
    const record = records.find((item) => item.id === sessionId);
    if (!record) {
      throw captureError(404, 'CAPTURE_SESSION_NOT_FOUND', 'Capture session not found');
    }
    return record;
  }

  // Serialized read-modify-write of one session record. In-memory holders
  // (active / recently finished) are refreshed so a later write from the
  // companion path does not resurrect the pre-patch record.
  async patchRecord(context, sessionId, patch) {
    return this.enqueueMutation(async () => {
      const record = await this.findRecord(context, sessionId);
      const { record: persisted } = await this.recordStore.write({
        ...context,
        data: patch(record),
      });
      if (this.activeSession && this.activeSession.record.id === sessionId) {
        this.activeSession.record = persisted;
      }
      const finished = this.finishedSessions.get(sessionId);
      if (finished) finished.record = persisted;
      return persisted;
    });
  }

  // Persists a derived analysis onto a (usually finished) session record.
  async saveAnalysis(context, sessionId, analysis) {
    return this.patchRecord(context, sessionId, (record) => ({ ...record, analysis }));
  }

  async timeline(context, sessionId) {
    const record = await this.findRecord(context, sessionId);
    const gazeSamples = await this.gazeLog.read({ ...context, sessionId });
    return buildTimeline({ session: record, gazeSamples });
  }

  // Raw samples for the replay overlay (the timeline only carries 5s bins).
  async gazeSamples(context, sessionId) {
    await this.findRecord(context, sessionId);
    return this.gazeLog.read({ ...context, sessionId });
  }

  async resolveVideo(context, sessionId, kind) {
    await this.findRecord(context, sessionId);
    return this.videoStore.resolve({ ...context, sessionId, kind });
  }

  async resolveAudio(context, sessionId) {
    await this.findRecord(context, sessionId);
    return this.audioStore.resolve({ ...context, sessionId });
  }
}

module.exports = { CaptureSessionService };
