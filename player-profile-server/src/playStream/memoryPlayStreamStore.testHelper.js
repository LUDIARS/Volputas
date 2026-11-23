// テスト用の playStreamStore の代役 (play_sessions / play_events をメモリに持つ)。本番では使わない。

const { SESSION_SUMMARY_EVENT_TYPE } = require('../services/trialResult');

/** now: 記録の時刻 (play_events.occurred_at、本物は DB の now())。テストで進められる。 */
function createMemoryPlayStreamStore({ now = () => new Date() } = {}) {
  const sessions = new Map();
  const events = [];
  return {
    sessions,
    events,
    async createSession({ id, userId, playerId = null, gameId, startedAt, metadata }) {
      if (sessions.has(id)) return 'duplicate';
      sessions.set(id, { id, user_id: userId, ludellus_player_id: playerId, game_id: gameId, started_at: new Date(startedAt), ended_at: null, metadata });
      return 'created';
    },
    async findSession(id) {
      const session = sessions.get(id);
      return session ? { ...session } : null;
    },
    async hasEvent(sessionId, seq) {
      return events.some((event) => event.session_id === sessionId && event.event_data.seq === seq);
    },
    async countEvents(sessionId) {
      return events.filter((event) => event.session_id === sessionId).length;
    },
    async insertEvent({ sessionId, eventType, eventData }) {
      events.push({ session_id: sessionId, event_type: eventType, event_data: eventData, occurred_at: now() });
    },
    async listEvents(sessionId) {
      return events.filter((event) => event.session_id === sessionId);
    },
    async endSession({ id, userId, endedAt, summary }) {
      const session = sessions.get(id);
      if (!session || session.user_id !== userId || session.ended_at) return null;
      session.ended_at = new Date(endedAt);
      events.push({ session_id: id, event_type: SESSION_SUMMARY_EVENT_TYPE, event_data: summary, occurred_at: new Date(endedAt) });
      return { ...session };
    },
    async listSummaries({ userId, gameId = null, playerId = null, limit = 200 }) {
      return [...sessions.values()]
        .filter((session) => session.user_id === userId && session.ended_at && (gameId === null || session.game_id === gameId)
          && (playerId === null || session.ludellus_player_id === playerId))
        .sort((a, b) => b.ended_at - a.ended_at)
        .slice(0, limit)
        .map((session) => ({
          id: session.id,
          game_id: session.game_id,
          ludellus_player_id: session.ludellus_player_id,
          started_at: session.started_at,
          ended_at: session.ended_at,
          summary: events.find((event) => event.session_id === session.id && event.event_type === SESSION_SUMMARY_EVENT_TYPE)?.event_data,
        }));
    },
    async listUnsummarizedSessions({ idleBefore, limit = 100 }) {
      const summarized = (id) => events.some((event) => event.session_id === id && event.event_type === SESSION_SUMMARY_EVENT_TYPE);
      return [...sessions.values()]
        .filter((session) => !summarized(session.id))
        .map((session) => {
          const times = events.filter((event) => event.session_id === session.id).map((event) => event.occurred_at.getTime());
          return { ...session, last_event_at: new Date(Math.max(session.started_at.getTime(), ...times)) };
        })
        .filter((session) => session.last_event_at < idleBefore)
        .sort((a, b) => a.started_at - b.started_at)
        .slice(0, limit);
    },
    async closeIdleSession({ id, seenEndedAt, endedAt, summary }) {
      const session = sessions.get(id);
      const timeOf = (value) => (value ? new Date(value).getTime() : null);
      if (!session || timeOf(session.ended_at) !== timeOf(seenEndedAt)) return null;
      if (events.some((event) => event.session_id === id && event.event_type === SESSION_SUMMARY_EVENT_TYPE)) return null;
      session.ended_at = new Date(endedAt);
      events.push({ session_id: id, event_type: SESSION_SUMMARY_EVENT_TYPE, event_data: summary, occurred_at: new Date(endedAt) });
      return { ...session };
    },
  };
}

module.exports = { createMemoryPlayStreamStore };
