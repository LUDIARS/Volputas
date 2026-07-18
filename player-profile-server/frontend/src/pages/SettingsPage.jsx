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

  const [memoriaStatus, setMemoriaStatus] = useState(null);
  const [memoriaBaseUrl, setMemoriaBaseUrl] = useState('');
  const [memoriaToken, setMemoriaToken] = useState('');
  const [memoriaBusy, setMemoriaBusy] = useState(false);
  const [memoriaError, setMemoriaError] = useState('');

  useEffect(() => {
    if (user) {
      setDisplayName(user.display_name || '');
      setAvatarUrl(user.avatar_url || '');
      setLocale(user.locale || 'ja');
    }
    loadIdentities();
    loadMemoriaStatus();
  }, [user]);

  async function loadIdentities() {
    try {
      const res = await api('/api/v1/users/me/identities');
      setIdentities(res.data);
    } catch { /* ignore */ }
  }

  async function loadMemoriaStatus() {
    try {
      const res = await api('/api/v1/users/me/memoria');
      setMemoriaStatus(res.data);
    } catch { /* ignore */ }
  }

  async function handleLinkMemoria(e) {
    e.preventDefault();
    setMemoriaBusy(true);
    setMemoriaError('');
    try {
      await api('/api/v1/users/me/memoria/link', {
        method: 'POST',
        body: { baseUrl: memoriaBaseUrl, token: memoriaToken },
      });
      setMemoriaBaseUrl('');
      setMemoriaToken('');
      await loadMemoriaStatus();
    } catch (err) {
      setMemoriaError(err.message || 'Failed to link Memoria');
    } finally {
      setMemoriaBusy(false);
    }
  }

  async function handleSyncMemoria() {
    setMemoriaBusy(true);
    setMemoriaError('');
    try {
      await api('/api/v1/users/me/memoria/sync', { method: 'POST' });
      await loadMemoriaStatus();
    } catch (err) {
      setMemoriaError(err.message || 'Failed to sync Memoria');
    } finally {
      setMemoriaBusy(false);
    }
  }

  async function handleUnlinkMemoria() {
    if (!confirm('Unlink your Memoria account?')) return;
    setMemoriaBusy(true);
    setMemoriaError('');
    try {
      await api('/api/v1/users/me/memoria', { method: 'DELETE' });
      await loadMemoriaStatus();
    } catch (err) {
      setMemoriaError(err.message || 'Failed to unlink Memoria');
    } finally {
      setMemoriaBusy(false);
    }
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

        {/* Memoria Integration */}
        <div className="card">
          <h3>Memoria連携 (性格傾向)</h3>
          <p className="muted" style={{ marginBottom: '1rem' }}>
            Memoriaの設定画面 (🔌連携 → Voluptas連携) でトークンを発行し、Memoriaのサーバー URL と
            あわせてここに入力してください。取り込んだ性格傾向は自動反映されず、Analysisページで
            内容を確認してから承認/却下できます。
          </p>

          {memoriaError && <div className="error-message">{memoriaError}</div>}

          {memoriaStatus?.linked ? (
            <div>
              <div className="identity-item">
                <div className="identity-info">
                  <span className="identity-provider">{memoriaStatus.link.memoriaBaseUrl}</span>
                  <span className="identity-date">
                    連携日 {new Date(memoriaStatus.link.linkedAt).toLocaleDateString('ja-JP')}
                    {memoriaStatus.link.lastSyncedAt && (
                      <> / 最終同期 {new Date(memoriaStatus.link.lastSyncedAt).toLocaleDateString('ja-JP')}</>
                    )}
                  </span>
                </div>
              </div>
              {memoriaStatus.latestDraft?.status === 'pending' && (
                <div className="info-banner" style={{ marginTop: '0.75rem' }}>
                  未承認の性格傾向ドラフトがあります。Analysisページで確認してください。
                </div>
              )}
              <div className="edit-actions" style={{ marginTop: '1rem' }}>
                <button className="btn-outline" onClick={handleSyncMemoria} disabled={memoriaBusy}>
                  {memoriaBusy ? '同期中...' : '今すぐ同期'}
                </button>
                <button className="btn-outline" onClick={handleUnlinkMemoria} disabled={memoriaBusy}>
                  連携解除
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleLinkMemoria}>
              <div className="form-group">
                <label className="field-label">Memoria サーバー URL</label>
                <input
                  value={memoriaBaseUrl}
                  onChange={(e) => setMemoriaBaseUrl(e.target.value)}
                  placeholder="http://localhost:5180"
                  required
                />
              </div>
              <div className="form-group">
                <label className="field-label">連携トークン</label>
                <input
                  type="password"
                  value={memoriaToken}
                  onChange={(e) => setMemoriaToken(e.target.value)}
                  placeholder="Memoriaで発行したトークン"
                  required
                />
              </div>
              <button type="submit" className="btn-primary" disabled={memoriaBusy}>
                {memoriaBusy ? 'Linking...' : 'Memoriaと連携'}
              </button>
            </form>
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
