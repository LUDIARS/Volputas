import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { api } from '../lib/api';
import '../styles/settings.css';

export default function SettingsPage() {
  const { user, refetchUser, logout } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [locale, setLocale] = useState('');
  const [identities, setIdentities] = useState([]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (user) {
      setDisplayName(user.display_name || '');
      setAvatarUrl(user.avatar_url || '');
      setLocale(user.locale || 'ja');
    }
    loadIdentities();
  }, [user]);

  async function loadIdentities() {
    try {
      const res = await api('/api/v1/users/me/identities');
      setIdentities(res.data);
    } catch { /* ignore */ }
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await api('/api/v1/users/me', {
        method: 'PATCH',
        body: {
          display_name: displayName,
          avatar_url: avatarUrl || null,
          locale,
        },
      });
      await refetchUser();
      setSuccess('Settings saved');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function unlinkIdentity(provider) {
    if (!confirm(`Unlink ${provider}?`)) return;
    try {
      await api(`/api/v1/users/me/identities/${provider}`, { method: 'DELETE' });
      loadIdentities();
    } catch (err) {
      setError(err.message || 'Failed to unlink');
    }
  }

  async function handleDeleteAccount() {
    if (!confirm('Are you sure you want to delete your account? This cannot be undone.')) return;
    setDeleting(true);
    try {
      await api('/api/v1/users/me', { method: 'DELETE' });
      logout();
    } catch (err) {
      setError(err.message || 'Failed to delete account');
      setDeleting(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h2>Settings</h2>
        <p>Manage your account and linked identities</p>
      </div>

      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}

      <div className="settings-grid">
        {/* Account Settings */}
        <div className="card">
          <h3>Account</h3>
          <form onSubmit={handleSave}>
            <div className="form-group">
              <label className="field-label">Display Name</label>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={100}
                required
              />
            </div>

            <div className="form-group">
              <label className="field-label">Avatar URL</label>
              <input
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
                placeholder="https://example.com/avatar.png"
              />
              {avatarUrl && (
                <div className="avatar-preview">
                  <img src={avatarUrl} alt="Preview" onError={(e) => e.target.style.display = 'none'} />
                </div>
              )}
            </div>

            <div className="form-group">
              <label className="field-label">Locale</label>
              <select value={locale} onChange={(e) => setLocale(e.target.value)}>
                <option value="ja">Japanese (ja)</option>
                <option value="en">English (en)</option>
                <option value="ko">Korean (ko)</option>
                <option value="zh">Chinese (zh)</option>
              </select>
            </div>

            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </form>
        </div>

        {/* Linked Identities */}
        <div className="card">
          <h3>Linked Identities</h3>
          {identities.length === 0 ? (
            <p className="muted">No linked identities</p>
          ) : (
            <div className="identity-list">
              {identities.map((id) => (
                <div key={id.id} className="identity-item">
                  <div className="identity-info">
                    <span className="identity-provider">{id.provider}</span>
                    {id.email && <span className="identity-email">{id.email}</span>}
                    <span className="identity-date">
                      Linked {new Date(id.linked_at).toLocaleDateString('ja-JP')}
                    </span>
                  </div>
                  <button
                    className="btn-outline"
                    style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                    onClick={() => unlinkIdentity(id.provider)}
                  >
                    Unlink
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Danger Zone */}
        <div className="card danger-zone">
          <h3>Danger Zone</h3>
          <p className="muted" style={{ marginBottom: '1rem' }}>
            Permanently delete your account and all associated data.
          </p>
          <button
            className="btn-danger"
            onClick={handleDeleteAccount}
            disabled={deleting}
          >
            {deleting ? 'Deleting...' : 'Delete Account'}
          </button>
        </div>
      </div>
    </div>
  );
}
