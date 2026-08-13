const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CODE_TTL_MS,
  FINISHED_TOKEN_TTL_MS,
  TOKEN_IDLE_TTL_MS,
  CapturePairing,
} = require('./capturePairing');

function pairingAt(startMs, codes = ['111111', '222222']) {
  let nowMs = startMs;
  const queue = [...codes];
  const pairing = new CapturePairing({
    now: () => nowMs,
    randomCode: () => queue.shift() || '999999',
  });
  return { pairing, advance: (ms) => { nowMs += ms; } };
}

test('a code pairs a companion to the session it was issued for', () => {
  const { pairing } = pairingAt(1000);
  const issued = pairing.issueCode('session-1');
  assert.equal(issued.code, '111111');
  const claimed = pairing.claim('111111');
  assert.equal(claimed.sessionId, 'session-1');
  assert.deepEqual(pairing.verify(claimed.token), {
    sessionId: 'session-1',
    deviceId: claimed.deviceId,
  });
  assert.throws(() => pairing.claim('111111'), /unknown or expired/);
});

test('codes and idle tokens expire', () => {
  const { pairing, advance } = pairingAt(0);
  pairing.issueCode('session-1');
  advance(CODE_TTL_MS + 1);
  assert.throws(() => pairing.claim('111111'), /unknown or expired/);
  assert.throws(() => pairing.verify('nope'), /token is unknown/);

  pairing.issueCode('session-2');
  const { token } = pairing.claim('222222');
  advance(TOKEN_IDLE_TTL_MS + 1);
  assert.throws(() => pairing.verify(token), /expired/);
});

test('finished-session tokens only survive through the audio upload grace period', () => {
  const { pairing, advance } = pairingAt(0);
  const { token } = pairing.claim(pairing.issueCode('session-1').code);
  pairing.finishSession('session-1');
  advance(FINISHED_TOKEN_TTL_MS / 2);
  pairing.verify(token);
  advance(FINISHED_TOKEN_TTL_MS / 2 + 1);
  assert.throws(() => pairing.verify(token), /expired/);
});

test('issuing without a session fails instead of minting an orphan code', () => {
  const { pairing } = pairingAt(0);
  assert.throws(() => pairing.issueCode(null), /No active capture session/);
});

test('issuing a replacement invalidates the previous code for that session', () => {
  const { pairing } = pairingAt(0);
  pairing.issueCode('session-1');
  assert.equal(pairing.issueCode('session-1').code, '222222');
  assert.throws(() => pairing.claim('111111'), /unknown or expired/);
  assert.equal(pairing.claim('222222').sessionId, 'session-1');
});

test('starting a new session revokes codes and tokens of other sessions', () => {
  const { pairing } = pairingAt(0);
  pairing.issueCode('session-1');
  const old = pairing.claim('111111');
  pairing.issueCode('session-2');
  pairing.revokeOtherSessions('session-2');
  assert.throws(() => pairing.verify(old.token), /token is unknown/);
  assert.equal(pairing.claim('222222').sessionId, 'session-2');
});
