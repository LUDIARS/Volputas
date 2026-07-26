import { useEffect, useState } from 'react';
import ProfileFeatureLayout from '../components/ProfileFeatureLayout';
import ProfileField from '../components/ProfileField';
import { localApi } from '../lib/localApi';

const INITIAL_FORM = {
  gameTitle: '',
  scopeType: 'game',
  contentName: '',
  sentiment: '0',
  comment: '',
  tags: '',
};

const SENTIMENTS = {
  '-2': '強い不満',
  '-1': 'やや不満',
  0: '中立',
  1: 'やや好意的',
  2: '強く好意的',
};

export default function VoicePage() {
  const [form, setForm] = useState(INITIAL_FORM);
  const [records, setRecords] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    localApi('/api/local/voices').then(setRecords).catch((reason) => setError(reason.message));
  }, []);

  function update(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const result = await localApi('/api/local/voices', { method: 'POST', body: form });
      setRecords((current) => [result.record, ...current]);
      setForm(INITIAL_FORM);
      setSuccess('ユーザの声を保存しました。');
    } catch (reason) {
      setError(reason.message);
    } finally {
      setSaving(false);
    }
  }

  const entryForm = (
    <form onSubmit={submit}>
      <h3>感想を登録</h3>
      <p className="form-intro">ゲーム全体、またはゲーム内の特定コンテンツに対する声を残します。</p>
      <ProfileField label="ゲーム名">
        <input name="gameTitle" value={form.gameTitle} onChange={update} required />
      </ProfileField>
      <ProfileField label="対象">
        <select name="scopeType" value={form.scopeType} onChange={update}>
          <option value="game">ゲーム全体</option>
          <option value="content">ゲーム内コンテンツ</option>
        </select>
      </ProfileField>
      {form.scopeType === 'content' && (
        <ProfileField label="コンテンツ名">
          <input name="contentName" value={form.contentName} onChange={update} required />
        </ProfileField>
      )}
      <ProfileField label="感情">
        <select name="sentiment" value={form.sentiment} onChange={update}>
          {Object.entries(SENTIMENTS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </ProfileField>
      <ProfileField label="感想">
        <textarea name="comment" rows="6" value={form.comment} onChange={update} required />
      </ProfileField>
      <ProfileField label="タグ" hint="カンマ区切り（例: 物語, UI, 協力プレイ）">
        <input name="tags" value={form.tags} onChange={update} />
      </ProfileField>
      <button className="btn-primary" disabled={saving}>{saving ? '保存中…' : '投稿する'}</button>
    </form>
  );

  return (
    <ProfileFeatureLayout
      title="ユーザの声"
      description="ゲーム内容と個別コンテンツに対する感想を、対象と感情を添えて蓄積します。"
      form={entryForm}
      records={records}
      error={error}
      success={success}
      emptyMessage="投稿された声はまだありません。"
      renderRecord={(record) => (
        <article className="card profile-record" key={record.id}>
          <div className="record-heading">
            <div>
              <h4>{record.gameTitle}</h4>
              <span>{record.scopeType === 'content' ? record.contentName : 'ゲーム全体'}</span>
            </div>
            <span className={`sentiment sentiment-${record.sentiment}`}>
              {SENTIMENTS[record.sentiment]}
            </span>
          </div>
          <p className="record-comment">{record.comment}</p>
          <div className="tags-row">{record.tags?.map((tag) => <span className="tag" key={tag}>{tag}</span>)}</div>
        </article>
      )}
    />
  );
}
