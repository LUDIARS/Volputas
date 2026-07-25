import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { localApi } from '../lib/localApi';
import '../styles/settings.css';
import '../styles/local.css';

const EMPTY_FORM = {
  dataRepositoryPath: '',
  githubName: '',
};

export default function LocalSettingsPage() {
  const { reloadSurveys } = useOutletContext();
  const [form, setForm] = useState(EMPTY_FORM);
  const [gitAuthor, setGitAuthor] = useState(null);
  const [configurationError, setConfigurationError] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    localApi('/api/local/config')
      .then((data) => {
        if (data.config) setForm(data.config);
        setGitAuthor(data.gitAuthor);
        setConfigurationError(data.configurationError || '');
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
      setForm(data.config);
      setGitAuthor(data.gitAuthor);
      await reloadSurveys();
      setSuccess('設定を保存しました');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="loading-spinner">Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <h2>Local Settings</h2>
        <p>回答を保存するGitリポジトリとGitHub名を設定します。</p>
      </div>

      {error && <div className="error-message">{error}</div>}
      {configurationError && <div className="error-message">{configurationError}</div>}
      {success && <div className="success-message">{success}</div>}

      <div className="settings-grid local-settings-grid">
        <form className="card" onSubmit={save}>
          <h3>Volputas-Data</h3>
          <div className="form-group">
            <label className="field-label" htmlFor="data-repository-path">
              データリポジトリのローカルパス
            </label>
            <input
              id="data-repository-path"
              value={form.dataRepositoryPath}
              onChange={(event) => updateField('dataRepositoryPath', event.target.value)}
              placeholder="例: E:\Data\Volputas-Data"
              required
            />
          </div>
          <div className="form-group">
            <label className="field-label" htmlFor="github-name">
              GitHub名
            </label>
            <input
              id="github-name"
              value={form.githubName}
              onChange={(event) => updateField('githubName', event.target.value)}
              placeholder="octocat"
              required
            />
          </div>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? '保存中...' : '設定を保存'}
          </button>
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
              設定保存時に、対象リポジトリのgit user.nameとuser.emailを確認します。
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
