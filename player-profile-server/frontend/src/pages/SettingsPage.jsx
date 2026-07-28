import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { api } from '../lib/api';
import '../styles/settings.css';

export default function SettingsPage() {
  const { user, refetchUser, logout } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [locale, setLocale] = useState('');
  const [researchExportConsent, setResearchExportConsent] = useState(false);
  const [identities, setIdentities] = useState([]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [steamStatus, setSteamStatus] = useState(null);
  const [steamInput, setSteamInput] = useState('');
  const [steamBusy, setSteamBusy] = useState(false);
  const [steamError, setSteamError] = useState('');
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
      setResearchExportConsent(user.research_export_consent === true);
    }
    loadIdentities();
    loadSteamStatus();
    loadMemoriaStatus();
  }, [user]);

  async function loadIdentities() {
    try {
      const res = await api('/api/v1/users/me/identities');
      setIdentities(res.data);
    } catch { /* ignore */ }
  }

  async function loadSteamStatus() {
    try {
      const res = await api('/api/v1/users/me/steam');
      setSteamStatus(res.data);
    } catch { /* ignore */ }
  }

  async function handleLinkSteam(e) {
    e.preventDefault();
    setSteamBusy(true);
    setSteamError('');
    try {
      await api('/api/v1/users/me/steam/link', { method: 'POST', body: { steamId: steamInput } });
      setSteamInput('');
      await loadSteamStatus();
    loadMemoriaStatus();
    } catch (err) {
      setSteamError(err.message || 'Failed to link Steam account');
    } finally {
      setSteamBusy(false);
    }
  }

  async function handleSyncSteam() {
    setSteamBusy(true);
    setSteamError('');
    try {
      await api('/api/v1/users/me/steam/sync', { method: 'POST' });
      await loadSteamStatus();
    loadMemoriaStatus();
    } catch (err) {
      setSteamError(err.message || 'Failed to sync Steam library');
    } finally {
      setSteamBusy(false);
    }
  }

  async function handleUnlinkSteam() {
    if (!confirm('Unlink your Steam account?')) return;
    setSteamBusy(true);
    setSteamError('');
    try {
      await api('/api/v1/users/me/steam', { method: 'DELETE' });
      await loadSteamStatus();
    loadMemoriaStatus();
    } catch (err) {
      setSteamError(err.message || 'Failed to unlink Steam account');
    } finally {
      setSteamBusy(false);
    }
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
          research_export_consent: researchExportConsent,
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

            <div className="form-group consent-setting">
              <label>
                <input
                  type="checkbox"
                  checked={researchExportConsent}
                  onChange={(event) => setResearchExportConsent(event.target.checked)}
                />
                ペルソナの研究提供（仮名化）に同意する
              </label>
              <p className="muted">
                既定は off です。同意時も実名・メール・アカウント ID・回答本文は出力されません。
              </p>
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

        {/* Steam Integration */}
        <div className="card">
          <h3>Steam連携</h3>
          <p className="muted" style={{ marginBottom: '1rem' }}>
            公開SteamプロフィールのSteamID64・vanity URL・プロフィールURLを連携すると、
            所持ゲームとプレイ時間を取り込みます。
          </p>

          {steamError && <div className="error-message">{steamError}</div>}

          {steamStatus?.linked ? (
            <div>
              <div className="identity-item">
                <div className="identity-info">
                  {steamStatus.profile.avatar_url && (
                    <img
                      src={steamStatus.profile.avatar_url}
                      alt=""
                      style={{ width: 32, height: 32, borderRadius: '50%', marginRight: '0.5rem' }}
                    />
                  )}
                  <span className="identity-provider">
                    {steamStatus.profile.persona_name || steamStatus.profile.steam_id64}
                  </span>
                  {steamStatus.profile.last_synced_at && (
                    <span className="identity-date">
                      Synced {new Date(steamStatus.profile.last_synced_at).toLocaleDateString('ja-JP')}
                    </span>
                  )}
                </div>
              </div>

              {steamStatus.topGames?.length > 0 && (
                <div className="tags-row" style={{ marginTop: '0.75rem' }}>
                  {steamStatus.topGames.slice(0, 5).map((g) => (
                    <span className="tag" key={g.app_id}>
                      {g.name} ({Math.round(g.playtime_forever_minutes / 60)}h)
                    </span>
                  ))}
                </div>
              )}

              <div className="edit-actions" style={{ marginTop: '1rem' }}>
                <button className="btn-outline" onClick={handleSyncSteam} disabled={steamBusy}>
                  {steamBusy ? 'Syncing...' : '今すぐ同期'}
                </button>
                <button className="btn-outline" onClick={handleUnlinkSteam} disabled={steamBusy}>
                  連携解除
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleLinkSteam}>
              <div className="form-group">
                <label className="field-label">SteamID64 / vanity URL</label>
                <input
                  value={steamInput}
                  onChange={(e) => setSteamInput(e.target.value)}
                  placeholder="https://steamcommunity.com/id/yourname または 7656119..."
                  required
                />
              </div>
              <button type="submit" className="btn-primary" disabled={steamBusy}>
                {steamBusy ? 'Linking...' : 'Steamと連携'}
              </button>
            </form>
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
