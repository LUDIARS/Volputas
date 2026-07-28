import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import RadarChart from '../components/RadarChart';
import '../styles/profile.css';

const AVAILABLE_TAGS = [
  'aggressive', 'explorer', 'social', 'competitive', 'creative',
  'narrative', 'casual', 'hardcore', 'strategist', 'speedrunner',
  'collector', 'helper', 'solo', 'team-player',
];

const DIMENSIONS = [
  'Achievement', 'Exploration', 'Social', 'Competition',
  'Creativity', 'Narrative', 'Intensity', 'Mastery',
];

export default function ProfilePage() {
  const [profile, setProfile] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [selectedTags, setSelectedTags] = useState([]);
  const [personalityData, setPersonalityData] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [steamTopGames, setSteamTopGames] = useState(null);

  useEffect(() => {
    loadProfile();
    loadSteamTopGames();
  }, []);

  async function loadProfile() {
    try {
      const res = await api('/api/v1/users/me/profile');
      setProfile(res.data);
      setSelectedTags(res.data.playstyle_tags || []);
      setPersonalityData(
        res.data.personality_data ? JSON.stringify(res.data.personality_data, null, 2) : ''
      );
    } catch { /* ignore */ }
  }

  async function loadSteamTopGames() {
    try {
      const res = await api('/api/v1/users/me/steam');
      setSteamTopGames(res.data.linked ? res.data.topGames : null);
    } catch { /* ignore */ }
  }

  function toggleTag(tag) {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      let parsedPersonality = null;
      if (personalityData.trim()) {
        parsedPersonality = JSON.parse(personalityData);
      }

      const res = await api('/api/v1/users/me/profile', {
        method: 'PUT',
        body: {
          playstyle_tags: selectedTags,
          personality_data: parsedPersonality,
        },
      });
      setProfile(res.data);
      setEditMode(false);
      setSuccess('Profile updated');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  if (!profile) return <div className="loading-spinner">Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <h2>Player Profile</h2>
        <p>Your playstyle, personality, and preference data</p>
      </div>

      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}

      <div className="profile-grid">
        {/* Preference Radar */}
        <div className="card">
          <h3>Preference Radar</h3>
          {profile.preference_vector?.length > 0 ? (
            <>
              <RadarChart dimensions={DIMENSIONS} vector={profile.preference_vector} />
              <div className="vector-version">
                Version {profile.preference_version}
              </div>
            </>
          ) : (
            <div className="empty-state">Run analysis to generate your preference chart</div>
          )}
        </div>

        {/* Steam Top Games */}
        {steamTopGames?.length > 0 && (
          <div className="card">
            <h3>Steamでよく遊んでいるゲーム</h3>
            <div className="tags-row">
              {steamTopGames.slice(0, 5).map((g) => (
                <span className="tag" key={g.app_id}>
                  {g.name} ({Math.round(g.playtime_forever_minutes / 60)}h)
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Playstyle Tags */}
        <div className="card">
          <div className="card-header-row">
            <h3>Playstyle Tags</h3>
            {!editMode && (
              <button className="btn-outline" onClick={() => setEditMode(true)}
                style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem' }}>
                Edit
              </button>
            )}
          </div>

          {editMode ? (
            <div>
              <div className="tag-selector">
                {AVAILABLE_TAGS.map((tag) => (
                  <button
                    key={tag}
                    className={`tag-btn ${selectedTags.includes(tag) ? 'selected' : ''}`}
                    onClick={() => toggleTag(tag)}
                  >
                    {tag}
                  </button>
                ))}
              </div>

              <div style={{ marginTop: '1rem' }}>
                <label className="field-label">Personality Data (JSON)</label>
                <textarea
                  value={personalityData}
                  onChange={(e) => setPersonalityData(e.target.value)}
                  rows={5}
                  placeholder='{ "mbti": "INTJ", "bartle": "explorer" }'
                />
              </div>

              <div className="edit-actions">
                <button className="btn-primary" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving...' : 'Save'}
                </button>
                <button className="btn-outline" onClick={() => {
                  setEditMode(false);
                  setSelectedTags(profile.playstyle_tags || []);
                }}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div>
              {profile.playstyle_tags?.length > 0 ? (
                <div className="tags-row">
                  {profile.playstyle_tags.map((tag) => (
                    <span className="tag" key={tag}>{tag}</span>
                  ))}
                </div>
              ) : (
                <p className="muted">No tags set — click Edit to add your playstyle</p>
              )}

              {profile.personality_data && (
                <div style={{ marginTop: '1rem' }}>
                  <label className="field-label">Personality Data</label>
                  <pre className="json-display">
                    {JSON.stringify(profile.personality_data, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
