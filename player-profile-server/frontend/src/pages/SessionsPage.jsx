import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import '../styles/sessions.css';

export default function SessionsPage() {
  const [sessions, setSessions] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [selectedSession, setSelectedSession] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const limit = 20;

  useEffect(() => {
    loadSessions();
  }, [offset]);

  async function loadSessions() {
    setLoading(true);
    try {
      const res = await api(`/api/v1/sessions?limit=${limit}&offset=${offset}`);
      setSessions(res.data);
      setTotal(res.pagination?.total || 0);
    } catch { /* ignore */ }
    setLoading(false);
  }

  async function viewEvents(session) {
    setSelectedSession(session);
    try {
      const res = await api(`/api/v1/sessions/${session.id}/events`);
      setEvents(res.data);
    } catch {
      setEvents([]);
    }
  }

  async function endSession(id) {
    try {
      await api(`/api/v1/sessions/${id}`, { method: 'PATCH' });
      loadSessions();
    } catch { /* ignore */ }
  }

  function formatDuration(start, end) {
    if (!end) return 'In progress';
    const ms = new Date(end) - new Date(start);
    const mins = Math.floor(ms / 60000);
    const hrs = Math.floor(mins / 60);
    if (hrs > 0) return `${hrs}h ${mins % 60}m`;
    return `${mins}m`;
  }

  return (
    <div>
      <div className="page-header">
        <h2>Play Sessions</h2>
        <p>Your game play history and event logs</p>
      </div>

      <div className="sessions-layout">
        {/* Sessions List */}
        <div className="card sessions-list">
          <h3>Sessions ({total})</h3>

          {loading ? (
            <div className="loading-spinner">Loading...</div>
          ) : sessions.length === 0 ? (
            <div className="empty-state">No play sessions recorded</div>
          ) : (
            <>
              <div className="session-items">
                {sessions.map((s) => (
                  <div
                    key={s.id}
                    className={`session-item ${selectedSession?.id === s.id ? 'active' : ''}`}
                    onClick={() => viewEvents(s)}
                  >
                    <div className="session-game">{s.game_id}</div>
                    <div className="session-meta">
                      <span>{new Date(s.started_at).toLocaleString('ja-JP')}</span>
                      <span>{formatDuration(s.started_at, s.ended_at)}</span>
                    </div>
                    <div className="session-actions">
                      <span className={`status ${s.ended_at ? 'ended' : 'active'}`}>
                        {s.ended_at ? 'Ended' : 'Active'}
                      </span>
                      {!s.ended_at && (
                        <button
                          className="btn-outline"
                          style={{ fontSize: '0.7rem', padding: '0.2rem 0.4rem' }}
                          onClick={(e) => { e.stopPropagation(); endSession(s.id); }}
                        >
                          End
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {total > limit && (
                <div className="pagination">
                  <button
                    className="btn-outline"
                    disabled={offset === 0}
                    onClick={() => setOffset(Math.max(0, offset - limit))}
                  >
                    Prev
                  </button>
                  <span className="page-info">
                    {offset + 1}–{Math.min(offset + limit, total)} of {total}
                  </span>
                  <button
                    className="btn-outline"
                    disabled={offset + limit >= total}
                    onClick={() => setOffset(offset + limit)}
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Event Detail */}
        <div className="card events-panel">
          <h3>Events</h3>
          {!selectedSession ? (
            <div className="empty-state">Select a session to view events</div>
          ) : events.length === 0 ? (
            <div className="empty-state">No events in this session</div>
          ) : (
            <div className="event-list">
              {events.map((e) => (
                <div key={e.id} className="event-item">
                  <div className="event-header">
                    <span className="tag">{e.event_type}</span>
                    <span className="event-time">
                      {new Date(e.occurred_at).toLocaleTimeString('ja-JP')}
                    </span>
                  </div>
                  <pre className="json-display">
                    {JSON.stringify(e.event_data, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
