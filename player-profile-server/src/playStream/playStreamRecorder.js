// 検証済みフレームを保存し、返事を決める (SPEC-VO-PLAY-STREAM-IDEMPOTENT / SPEC-VO-PLAY-STREAM-SUMMARY)。
// 通信 (WebSocket) と検証 (playStreamFrames) は持たない。

const { summarizePlaySession } = require('./playSessionSummary');

/** 1 セッションに保存する記録の上限。 */
const MAX_EVENTS_PER_SESSION = 5000;

function ack(frame) {
  return { type: 'ack', sessionId: frame.sessionId, seq: frame.seq };
}

function reject(code, frame) {
  return { type: 'error', code, sessionId: frame.sessionId, seq: frame.seq };
}

/**
 * @param {{ store: ReturnType<typeof import('./playStreamStore').createPlayStreamStore>, runPostSessionJobs?: (session: object) => Promise<unknown> }} deps
 */
function createPlayStreamRecorder({ store, runPostSessionJobs = async () => {} }) {
  async function start(userId, frame) {
    const result = await store.createSession({
      id: frame.sessionId,
      userId,
      gameId: frame.gameId,
      startedAt: frame.startedAt,
      metadata: frame.metadata ?? {},
    });
    if (result === 'duplicate') {
      const existing = await store.findSession(frame.sessionId);
      if (!existing || existing.user_id !== userId) return reject('forbidden', frame);
    }
    return ack(frame);
  }

  async function append(session, frame) {
    if (await store.hasEvent(frame.sessionId, frame.seq)) return ack(frame);
    // 終了後に届く新しい記録は受けない (終了前に保存済みの再送には上で ack を返している)。
    if (session.ended_at) return reject('session_ended', frame);
    if (await store.countEvents(frame.sessionId) >= MAX_EVENTS_PER_SESSION) return reject('limit', frame);
    await store.insertEvent({ sessionId: frame.sessionId, eventType: frame.eventType, eventData: frame.eventData });
    return ack(frame);
  }

  async function end(userId, session, frame) {
    // 終了の再送 (ack を受け取れなかった) は集計を作り直さず ack だけ返す。
    if (session.ended_at) return ack(frame);
    if (new Date(frame.endedAt).getTime() < new Date(session.started_at).getTime()) return reject('invalid_frame', frame);
    const events = await store.listEvents(frame.sessionId);
    const summary = summarizePlaySession({ startedAt: session.started_at, endedAt: frame.endedAt, reason: frame.reason, events });
    const ended = await store.endSession({ id: frame.sessionId, userId, endedAt: frame.endedAt, summary });
    // 能力推定・出題の較正 (既存の §12 終了時ジョブ)。終了の返事は待たせない。
    if (ended) runPostSessionJobs(ended).catch(() => {});
    return ack(frame);
  }

  return {
    /** @implements SPEC-VO-PLAY-STREAM-IDEMPOTENT */
    async handle(userId, frame) {
      if (frame.type === 'session_start') return start(userId, frame);
      const session = await store.findSession(frame.sessionId);
      if (!session) return reject('unknown_session', frame);
      if (session.user_id !== userId) return reject('forbidden', frame);
      if (frame.type === 'session_end') return end(userId, session, frame);
      return append(session, frame);
    },
  };
}

module.exports = { createPlayStreamRecorder, MAX_EVENTS_PER_SESSION };
