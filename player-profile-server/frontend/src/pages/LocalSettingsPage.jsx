import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { localApi } from '../lib/localApi';
import '../styles/settings.css';
import '../styles/local.css';

const EMPTY_FORM = {
  dataRepositoryPath: '',
};

export default function LocalSettingsPage() {
  const { reloadSurveys } = useOutletContext();
  const [form, setForm] = useState(EMPTY_FORM);
  const [gitStatus, setGitStatus] = useState(null);
  const [gitAuthor, setGitAuthor] = useState(null);
  const [configurationError, setConfigurationError] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      localApi('/api/local/config'),
      localApi('/api/local/environment'),
    ])
      .then(([configData, environmentData]) => {
        if (configData.config) {
          setForm({ dataRepositoryPath: configData.config.dataRepositoryPath });
        }
        setGitAuthor(configData.gitAuthor);
        setConfigurationError(configData.configurationError || '');
        setGitStatus(environmentData.git);
      })
      .catch((requestError) => setError(requestError.message))
      .finally(() => setLoading(false));
  }, []);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    setConfigurationError('');
    try {
      const data = await localApi('/api/local/config', { method: 'PUT', body: form });
      setForm({ dataRepositoryPath: data.config.dataRepositoryPath });
      setGitAuthor(data.gitAuthor);
      await reloadSurveys();
      setSuccess(`設定を保存しました。回答フォルダ名: ${data.config.name}`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function chooseRepository() {
    const selectedPath = await window.volputasDesktop?.chooseDataRepository();
    if (selectedPath) updateField('dataRepositoryPath', selectedPath);
  }

  async function openSetupScripts() {
    try {
      const result = await window.volputasDesktop?.openSetupScripts();
      if (result) setError(result);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  if (loading) return <div className="loading-spinner">Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <h2>Local Settings</h2>
        <p>回答を保存するGitリポジトリを選択します。NameはGit Authorから自動設定されます。</p>
      </div>

      {error && <div className="error-message">{error}</div>}
      {configurationError && <div className="error-message">{configurationError}</div>}
      {success && <div className="success-message">{success}</div>}

      <div className="settings-grid local-settings-grid">
        <form className="card" onSubmit={save}>
          <h3>VolputasData</h3>
          <div className={`git-cli-status ${gitStatus?.available ? 'available' : 'unavailable'}`}>
            <strong>Git CLI</strong>
            <span>
              {gitStatus?.available
                ? `${gitStatus.version} — PATH確認済み`
                : gitStatus?.error || '確認中'}
            </span>
          </div>
          <div className="form-group">
            <label className="field-label" htmlFor="data-repository-path">
              データリポジトリのローカルパス
            </label>
            <div className="repository-path-input">
              <input
                id="data-repository-path"
                value={form.dataRepositoryPath}
                onChange={(event) => updateField('dataRepositoryPath', event.target.value)}
                placeholder="例: E:\Data\VolputasData"
                required
              />
              {window.volputasDesktop && (
                <button type="button" className="btn-outline" onClick={chooseRepository}>
                  選択
                </button>
              )}
            </div>
          </div>
          <button
            type="submit"
            className="btn-primary"
            disabled={saving || !gitStatus?.available}
          >
            {saving ? '保存中...' : '設定を保存'}
          </button>
          {window.volputasDesktop && (
            <button type="button" className="btn-outline setup-script-button" onClick={openSetupScripts}>
              VolputasDataセットアップスクリプトを開く
            </button>
          )}
        </form>

        <section className="card">
          <h3>Git Author</h3>
          {gitAuthor ? (
            <dl className="local-author">
              <dt>Repository</dt>
              <dd>{gitAuthor.repositoryRoot}</dd>
              <dt>Name</dt>
              <dd>{gitAuthor.name}</dd>
              <dt>Email</dt>
              <dd>{gitAuthor.email}</dd>
              <dt>Remote</dt>
              <dd>{gitAuthor.remoteUrl}</dd>
            </dl>
          ) : (
            <p className="muted">
              設定保存時に、対象リポジトリのgit user.nameとuser.emailを自動取得します。
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
