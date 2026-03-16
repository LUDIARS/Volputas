import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import RadarChart from '../components/RadarChart';
import '../styles/analysis.css';

const DIMENSION_DESCRIPTIONS = {
  achievement: 'Goal completion, scores, and progress-oriented play',
  exploration: 'Map discovery, hidden elements, and wandering',
  social: 'Multiplayer, chat, and cooperative play',
  competition: 'PvP, rankings, and win-rate focus',
  creativity: 'Building, customization, and user-generated content',
  narrative: 'Story progression, dialogue choices, and lore',
  intensity: 'Play time, session frequency, and focus level',
  mastery: 'Difficulty selection, retry counts, and skill improvement',
};

export default function AnalysisPage() {
  const [profile, setProfile] = useState(null);
  const [dimensions, setDimensions] = useState([]);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [profileRes, dimRes] = await Promise.all([
        api('/api/v1/users/me/profile'),
        api('/api/v1/analysis/dimensions'),
      ]);
      setProfile(profileRes.data);
      setDimensions(dimRes.data);
    } catch { /* ignore */ }
    setLoading(false);
  }

  async function runAnalysis() {
    setRunning(true);
    setError('');
    try {
      const res = await api('/api/v1/analysis/me', { method: 'POST' });
      setAnalysisResult(res.data);
      // Refresh profile
      const profileRes = await api('/api/v1/users/me/profile');
      setProfile(profileRes.data);
    } catch (err) {
      setError(err.message || 'Analysis failed');
    } finally {
      setRunning(false);
    }
  }

  if (loading) return <div className="loading-spinner">Loading...</div>;

  const dimNames = dimensions.map((d) => d.name);
  const vector = analysisResult?.vector || profile?.preference_vector || [];
  const tags = analysisResult?.tags || profile?.playstyle_tags || [];

  return (
    <div>
      <div className="page-header">
        <h2>Preference Analysis</h2>
        <p>Analyze your play logs and survey responses to generate your preference profile</p>
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="analysis-grid">
        {/* Action Panel */}
        <div className="card analysis-action">
          <h3>Run Analysis</h3>
          <p className="muted" style={{ marginBottom: '1rem' }}>
            Aggregates your play events and survey responses to compute a preference vector
            across {dimensions.length} dimensions.
          </p>
          <button
            className="btn-accent"
            onClick={runAnalysis}
            disabled={running}
            style={{ width: '100%', padding: '0.75rem' }}
          >
            {running ? 'Analyzing...' : 'Run Preference Analysis'}
          </button>
          {profile?.preference_version > 0 && (
            <div className="version-info">
              Current version: {profile.preference_version}
              <br />
              Last updated: {new Date(profile.updated_at).toLocaleString('ja-JP')}
            </div>
          )}
        </div>

        {/* Radar Chart */}
        <div className="card analysis-chart">
          <h3>Preference Radar</h3>
          {vector.length > 0 ? (
            <RadarChart dimensions={dimNames} vector={vector} />
          ) : (
            <div className="empty-state">
              No analysis data yet. Click "Run Preference Analysis" to generate.
            </div>
          )}
        </div>

        {/* Dimension Details */}
        <div className="card analysis-details">
          <h3>Dimension Breakdown</h3>
          {vector.length > 0 ? (
            <div className="dimension-bars">
              {dimNames.map((name, i) => (
                <div key={name} className="dimension-row">
                  <div className="dim-header">
                    <span className="dim-name">{name}</span>
                    <span className="dim-value">{(vector[i] * 100).toFixed(1)}%</span>
                  </div>
                  <div className="dim-bar-bg">
                    <div
                      className="dim-bar-fill"
                      style={{ width: `${(vector[i] || 0) * 100}%` }}
                    />
                  </div>
                  <div className="dim-desc">
                    {DIMENSION_DESCRIPTIONS[name] || ''}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">Run analysis to see breakdown</div>
          )}
        </div>

        {/* Tags */}
        <div className="card analysis-tags">
          <h3>Derived Tags</h3>
          {tags.length > 0 ? (
            <div className="tags-row">
              {tags.map((tag) => (
                <span className="tag" key={tag}>{tag}</span>
              ))}
            </div>
          ) : (
            <div className="empty-state">Tags will be generated from analysis</div>
          )}
        </div>
      </div>
    </div>
  );
}
