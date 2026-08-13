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
  constructor({ recordStore, gazeLog, audioStore, pairing, now = () => new Date() }) {
    this.recordStore = recordStore;
    this.gazeLog = gazeLog;
    this.audioStore = audioStore;
    this.pairing = pairing;
    this.now = now;
    this.activeSession = null; // { record, context }
    this.finishedSessions = new Map(); // sessionId -> { record, context }
    this.mutationQueue = Promise.resolve();
    this.initializedContexts = new Set();
    this.contextInitializations = new Map();
    this.audioUploads = new Set();
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
        capture: { gazeSampleCount: 0, audioFileName: null, audioDurationSeconds: null },
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
        capture: { ...record.capture, gazeSampleCount: total },
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

  async attachAudio(token, { contentType, stream, durationSeconds }) {
    const { holder } = this.companionSession(token);
    const { record, context } = holder;
    if (record.status === 'recording') {
      throw captureError(409, 'CAPTURE_SESSION_RECORDING', 'Stop the capture session before uploading audio');
    }
    if (record.capture.audioFileName || this.audioUploads.has(record.id)) {
      throw captureError(409, 'CAPTURE_AUDIO_EXISTS', 'Session audio has already been uploaded');
    }
    this.audioUploads.add(record.id);
    try {
      const saved = await this.audioStore.save({
        ...context,
        sessionId: record.id,
        contentType,
        stream,
      });
      const updated = {
        ...holder.record,
        capture: {
          ...holder.record.capture,
          audioFileName: saved.fileName,
          audioDurationSeconds: durationSeconds,
        },
      };
      const { record: persisted } = await this.recordStore.write({ ...context, data: updated });
      holder.record = persisted;
      return { fileName: saved.fileName, bytes: saved.bytes };
    } finally {
      this.audioUploads.delete(record.id);
    }
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

  async timeline(context, sessionId) {
    const record = await this.findRecord(context, sessionId);
    const gazeSamples = await this.gazeLog.read({ ...context, sessionId });
    return buildTimeline({ session: record, gazeSamples });
  }

  async resolveAudio(context, sessionId) {
    await this.findRecord(context, sessionId);
    return this.audioStore.resolve({ ...context, sessionId });
  }
}

module.exports = { CaptureSessionService };
