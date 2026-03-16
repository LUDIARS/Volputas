import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import RadarChart from '../components/RadarChart';
import '../styles/analysis.css';

const PATTERN_LABELS = {
  gamer: {
    label: 'Gamer Pattern',
    description: 'MTG psychographic profiles',
    typeLabels: {
      timmy: 'Timmy/Tammy',
      johnny: 'Johnny/Jenny',
      spike: 'Spike',
      vorthos: 'Vorthos',
      melvin: 'Melvin',
    },
  },
  mechanics: {
    label: 'Mechanics Pattern',
    description: "Caillois' play categories",
    typeLabels: {
      agon: 'Agon (Competition)',
      alea: 'Alea (Luck)',
      ilinx: 'Ilinx (Vertigo)',
      mimicry: 'Mimicry (Imitation)',
    },
  },
  story: {
    label: 'Story Dynamics',
    description: "Berne's life scripts",
    typeLabels: {
      winner: 'Winner Script',
      banal: 'Banal Script',
      loser: 'Loser Script',
    },
  },
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

  const vector = analysisResult?.vector || profile?.preference_vector || [];
  const tags = analysisResult?.tags || profile?.playstyle_tags || [];
  const classification = analysisResult?.classification ||
    (profile?.classification_data ? JSON.parse(profile.classification_data) : null);
  const subtypes = analysisResult?.subtypes ||
    (profile?.subtype_data ? JSON.parse(profile.subtype_data) : null);

  // Group dimensions by pattern for separate radar charts
  const patternGroups = {
    gamer: { dims: [], values: [] },
    mechanics: { dims: [], values: [] },
    story: { dims: [], values: [] },
  };

  dimensions.forEach((d, i) => {
    const pattern = d.pattern || d.name.split('_')[0];
    if (patternGroups[pattern]) {
      const shortName = d.name.replace(`${pattern}_`, '');
      const labelMap = PATTERN_LABELS[pattern]?.typeLabels || {};
      patternGroups[pattern].dims.push(labelMap[shortName] || shortName);
      patternGroups[pattern].values.push(vector[i] || 0);
    }
  });

  return (
    <div>
      <div className="page-header">
        <h2>Hobby Classification Analysis</h2>
        <p>Analyze your play patterns across 3 classification frameworks</p>
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="analysis-grid">
        {/* Action Panel */}
        <div className="card analysis-action">
          <h3>Run Analysis</h3>
          <p className="muted" style={{ marginBottom: '1rem' }}>
            Classifies your play style using Gamer Pattern (MTG), Mechanics Pattern (Caillois),
            and Story Dynamics (Berne) across {dimensions.length} dimensions.
          </p>
          <button
            className="btn-accent"
            onClick={runAnalysis}
            disabled={running}
            style={{ width: '100%', padding: '0.75rem' }}
          >
            {running ? 'Analyzing...' : 'Run Classification Analysis'}
          </button>
          {profile?.preference_version > 0 && (
            <div className="version-info">
              Current version: {profile.preference_version}
              <br />
              Last updated: {new Date(profile.updated_at).toLocaleString('ja-JP')}
            </div>
          )}
        </div>

        {/* Pattern Radar Charts */}
        {Object.entries(patternGroups).map(([patternKey, group]) => (
          group.values.some((v) => v > 0) && (
            <div className="card analysis-chart" key={patternKey}>
              <h3>{PATTERN_LABELS[patternKey]?.label || patternKey}</h3>
              <p className="muted">{PATTERN_LABELS[patternKey]?.description}</p>
              <RadarChart dimensions={group.dims} vector={group.values} />
              {classification?.[patternKey] && (
                <div className="pattern-primary">
                  Primary: <strong>
                    {PATTERN_LABELS[patternKey]?.typeLabels[classification[patternKey].primary] ||
                      classification[patternKey].primary}
                  </strong>
                  {' '}({(classification[patternKey].primaryScore * 100).toFixed(1)}%)
                </div>
              )}
            </div>
          )
        ))}

        {/* No data state */}
        {vector.length === 0 && (
          <div className="card analysis-chart">
            <h3>Classification Radar</h3>
            <div className="empty-state">
              No analysis data yet. Click "Run Classification Analysis" to generate.
            </div>
          </div>
        )}

        {/* Classification Summary */}
        {classification && (
          <div className="card analysis-details">
            <h3>Classification Summary</h3>
            <div className="dimension-bars">
              {Object.entries(classification).map(([patternKey, result]) => (
                <div key={patternKey} className="pattern-section">
                  <h4>{result.label}</h4>
                  {Object.entries(result.scores).map(([typeKey, score]) => {
                    const label = PATTERN_LABELS[patternKey]?.typeLabels[typeKey] || typeKey;
                    return (
                      <div key={typeKey} className="dimension-row">
                        <div className="dim-header">
                          <span className="dim-name">{label}</span>
                          <span className="dim-value">{(score * 100).toFixed(1)}%</span>
                        </div>
                        <div className="dim-bar-bg">
                          <div
                            className={`dim-bar-fill ${typeKey === result.primary ? 'primary' : ''}`}
                            style={{ width: `${(score || 0) * 100}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Subtype Analysis */}
        {subtypes?.primarySubtype && (
          <div className="card analysis-details">
            <h3>Gamer Subtype</h3>
            <p className="muted">
              {subtypes.gamerLabel} &mdash; Subtype: <strong>{subtypes.primarySubtype}</strong>
            </p>
            <div className="dimension-bars">
              {Object.entries(subtypes.subtypeScores || {}).map(([subtype, score]) => (
                <div key={subtype} className="dimension-row">
                  <div className="dim-header">
                    <span className="dim-name">{subtype}</span>
                    <span className="dim-value">{score.toFixed(3)}</span>
                  </div>
                  <div className="dim-bar-bg">
                    <div
                      className={`dim-bar-fill ${subtype === subtypes.primarySubtype ? 'primary' : ''}`}
                      style={{ width: `${Math.min(score * 100, 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

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
