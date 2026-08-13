// Pairing between the desktop capture session and iPhone companions.
// A short-lived numeric code (typed on the phone) is exchanged for a bearer
// token; the token authenticates every companion request afterwards. Codes and
// tokens live in memory only — a process restart severs companions, which is
// acceptable because the capture session itself is driven by this process.
const { randomInt, randomUUID } = require('node:crypto');

const CODE_TTL_MS = 10 * 60 * 1000;
const TOKEN_IDLE_TTL_MS = 30 * 60 * 1000;
const FINISHED_TOKEN_TTL_MS = 10 * 60 * 1000;

function pairingError(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

class CapturePairing {
  constructor({ now = () => Date.now(), randomCode = () => String(randomInt(0, 1000000)).padStart(6, '0') } = {}) {
    this.now = now;
    this.randomCode = randomCode;
    this.codes = new Map(); // code -> { sessionId, expiresAtMs }
    this.tokens = new Map(); // token -> { sessionId, deviceId, expiresAtMs }
  }

  issueCode(sessionId) {
    if (!sessionId) throw pairingError(409, 'NO_ACTIVE_SESSION', 'No active capture session');
    const nowMs = this.now();
    for (const [code, entry] of this.codes) {
      if (entry.expiresAtMs <= nowMs || entry.sessionId === sessionId) this.codes.delete(code);
    }
    // Re-rolling on collision keeps codes 6 digits without ever handing the
    // same code to two sessions.
    let code = this.randomCode();
    for (let attempt = 0; this.codes.has(code) && attempt < 100; attempt += 1) {
      code = this.randomCode();
    }
    if (this.codes.has(code)) {
      throw pairingError(503, 'PAIRING_CODE_EXHAUSTED', 'Could not allocate a pairing code');
    }
    const expiresAtMs = nowMs + CODE_TTL_MS;
    this.codes.set(code, { sessionId, expiresAtMs });
    return { code, expiresAtMs };
  }

  claim(code) {
    const entry = this.codes.get(code);
    if (!entry || entry.expiresAtMs <= this.now()) {
      this.codes.delete(code);
      throw pairingError(401, 'INVALID_PAIRING_CODE', 'Pairing code is unknown or expired');
    }
    // A displayed code authorizes exactly one device. Pairing another device
    // requires the desktop to issue a fresh code, which prevents code replay.
    this.codes.delete(code);
    const token = randomUUID();
    const deviceId = randomUUID();
    this.tokens.set(token, {
      sessionId: entry.sessionId,
      deviceId,
      expiresAtMs: this.now() + TOKEN_IDLE_TTL_MS,
      isFinished: false,
    });
    return { token, deviceId, sessionId: entry.sessionId };
  }

  verify(token) {
    const entry = this.tokens.get(token);
    const nowMs = this.now();
    if (!entry || entry.expiresAtMs <= nowMs) {
      this.tokens.delete(token);
      throw pairingError(401, 'INVALID_COMPANION_TOKEN', 'Companion token is unknown or expired');
    }
    if (!entry.isFinished) entry.expiresAtMs = nowMs + TOKEN_IDLE_TTL_MS;
    return { sessionId: entry.sessionId, deviceId: entry.deviceId };
  }

  revokeToken(token) {
    this.tokens.delete(token);
  }

  finishSession(sessionId) {
    const expiresAtMs = this.now() + FINISHED_TOKEN_TTL_MS;
    for (const [code, entry] of this.codes) {
      if (entry.sessionId === sessionId) this.codes.delete(code);
    }
    for (const entry of this.tokens.values()) {
      if (entry.sessionId === sessionId) {
        entry.expiresAtMs = Math.min(entry.expiresAtMs, expiresAtMs);
        entry.isFinished = true;
      }
    }
  }

  // Called when a NEW session starts: any remaining grace-period credentials
  // from previous sessions must not attach data after focus moves to the new one.
  revokeOtherSessions(activeSessionId) {
    for (const [code, entry] of this.codes) {
      if (entry.sessionId !== activeSessionId) this.codes.delete(code);
    }
    for (const [token, entry] of this.tokens) {
      if (entry.sessionId !== activeSessionId) this.tokens.delete(token);
    }
  }
}

module.exports = {
  CODE_TTL_MS,
  FINISHED_TOKEN_TTL_MS,
  TOKEN_IDLE_TTL_MS,
  CapturePairing,
};
