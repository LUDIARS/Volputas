// テスト用のフレーム組み立て。本番では使わない。

const SESSION_ID = '6f1c2d4e-8a9b-4c3d-9e2f-1a2b3c4d5e6f';
const USER = '11111111-1111-4111-8111-111111111111';

function startFrame(overrides = {}) {
  return {
    type: 'session_start', sessionId: SESSION_ID, seq: 0, gameId: 'uni-math',
    startedAt: '2026-11-21T10:00:00.000Z', metadata: { mode: 'solo', platform: 'web' }, ...overrides,
  };
}

function trialFrame(seq, data = {}) {
  return {
    type: 'event', sessionId: SESSION_ID, seq, eventType: 'ludellus.trial_result',
    eventData: {
      v: 1, seq, mono_ms: seq * 1000, trial_id: `t-${seq}`, item_id: 'q1',
      presented_mono_ms: 0, response_ms: 800, outcome: 'correct', attempt: 1, ...data,
    },
  };
}

function metricFrame(seq, name, value) {
  return {
    type: 'event', sessionId: SESSION_ID, seq, eventType: 'ludellus.metric',
    eventData: { v: 1, seq, mono_ms: seq * 1000, name, value },
  };
}

function endFrame(seq, overrides = {}) {
  return {
    type: 'session_end', sessionId: SESSION_ID, seq, endedAt: '2026-11-21T10:05:00.000Z', reason: 'completed', ...overrides,
  };
}

module.exports = { SESSION_ID, USER, startFrame, trialFrame, metricFrame, endFrame };
