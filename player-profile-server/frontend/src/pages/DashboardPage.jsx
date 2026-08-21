import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { api } from '../lib/api';
import { RadarChart } from '@volputas/charts';
import '../styles/dashboard.css';

export default function DashboardPage() {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [stats, setStats] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [profileRes, sessionsRes] = await Promise.all([
          api('/api/v1/users/me/profile'),
          api('/api/v1/sessions?limit=5'),
        ]);
        setProfile(profileRes.data);
        setSessions(sessionsRes.data);

        try {
          const metricsRes = await fetch('/health/metrics');
          const metricsJson = await metricsRes.json();
          if (metricsJson.ok) setStats(metricsJson.data);
        } catch { /* metrics optional */ }
      } catch { /* ignore */ }
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <div className="loading-spinner">Loading...</div>;

  const dimensions = [
    'Achievement', 'Exploration', 'Social', 'Competition',
    'Creativity', 'Narrative', 'Intensity', 'Mastery',
  ];

  return (
    <div>
      <div className="page-header">
        <h2>Dashboard</h2>
        <p>Welcome back, {user?.display_name}</p>
      </div>

      <div className="dashboard-grid">
        {/* Profile Summary */}
        <div className="card dashboard-profile">
          <h3>Your Profile</h3>
          {profile?.playstyle_tags?.length > 0 ? (
            <div className="tags-row">
              {profile.playstyle_tags.map((tag) => (
                <span className="tag" key={tag}>{tag}</span>
              ))}
            </div>
          ) : (
            <p className="muted">No playstyle tags yet</p>
          )}

          {profile?.preference_vector?.length > 0 ? (
            <div className="chart-mini">
              <RadarChart dimensions={dimensions} vector={profile.preference_vector} />
            </div>
          ) : (
            <p className="muted">
              Run <Link to="/analysis">Analysis</Link> to generate your preference chart
            </p>
          )}
        </div>

        {/* Quick Stats */}
        <div className="card dashboard-stats">
          <h3>Quick Stats</h3>
          <div className="stat-grid">
            <div className="stat-item">
              <div className="stat-value">{sessions.length}</div>
              <div className="stat-label">Recent Sessions</div>
            </div>
            <div className="stat-item">
              <div className="stat-value">{profile?.preference_version || 0}</div>
              <div className="stat-label">Analysis Runs</div>
            </div>
            {stats && (
              <>
                <div className="stat-item">
                  <div className="stat-value">{stats.users_total}</div>
                  <div className="stat-label">Total Users</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{stats.events_total}</div>
                  <div className="stat-label">Total Events</div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Recent Sessions */}
        <div className="card dashboard-sessions">
          <div className="card-header-row">
            <h3>Recent Sessions</h3>
            <Link to="/sessions" className="btn-outline" style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem' }}>
              View All
            </Link>
          </div>
          {sessions.length === 0 ? (
            <p className="muted">No play sessions recorded yet</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Game</th>
                  <th>Started</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td>{s.game_id}</td>
                    <td>{new Date(s.started_at).toLocaleString('ja-JP')}</td>
                    <td>
                      <span className={`status ${s.ended_at ? 'ended' : 'active'}`}>
                        {s.ended_at ? 'Ended' : 'Active'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
