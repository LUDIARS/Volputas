import { useEffect, useState } from 'react';
import ProfileFeatureLayout from '../components/ProfileFeatureLayout';
import ProfileField from '../components/ProfileField';
import { useProfileClient } from '../lib/profileClient';
import lexicon from '../data/ludus-lexicon.json';

const INITIAL_FORM = {
  gameTitle: '',
  scopeType: 'game',
  contentName: '',
  sentiment: '0',
  polarity: '',
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

const MECHANICS = lexicon.mechanics;
const MECHANIC_NAME = Object.fromEntries(MECHANICS.map((item) => [item.id, item.nameJa]));

export default function VoicePage() {
  const client = useProfileClient();
  const [form, setForm] = useState(INITIAL_FORM);
  const [mechanicIds, setMechanicIds] = useState([]);
  const [mechanicInput, setMechanicInput] = useState('');
  const [records, setRecords] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    client.list('voices').then(setRecords).catch((reason) => setError(reason.message));
  }, [client]);

  function update(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  function addMechanic(rawValue) {
    // The datalist shows "id nameJa"; accept either the bare id or that form.
    const id = rawValue.trim().split(/\s+/)[0].toLowerCase();
    if (!id) return;
    const known = MECHANICS.find((item) => item.id === id);
    if (!known) {
      setError(`未知のメカニクス ID です: ${id} (候補から選択してください)`);
      return;
    }
    setError('');
    setMechanicIds((current) => (current.includes(id) ? current : [...current, id]));
    setMechanicInput('');
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const result = await client.create('voices', {
        ...form,
        polarity: form.polarity || null,
        mechanicIds,
      });
      setRecords((current) => [result.record, ...current]);
      setForm(INITIAL_FORM);
      setMechanicIds([]);
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
      <ProfileField label="スキ / 嫌い" hint="方向をワンタップで明示 (任意)。感情は強さとして併用されます">
        <div className="polarity-toggle" role="group" aria-label="スキ嫌い">
          <button
            type="button"
            className={form.polarity === 'like' ? 'polarity-active-like' : ''}
            onClick={() => setForm((current) => ({ ...current, polarity: current.polarity === 'like' ? '' : 'like' }))}
          >
            👍 スキ
          </button>
          <button
            type="button"
            className={form.polarity === 'dislike' ? 'polarity-active-dislike' : ''}
            onClick={() => setForm((current) => ({ ...current, polarity: current.polarity === 'dislike' ? '' : 'dislike' }))}
          >
            👎 嫌い
          </button>
        </div>
      </ProfileField>
      <ProfileField label="関連メカニクス" hint="Ludus 辞書から選択 (任意)。嫌い + メカニクスは忌避シグナルになります">
        <div className="mechanic-picker">
          <input
            list="ludus-mechanics"
            value={mechanicInput}
            onChange={(event) => setMechanicInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addMechanic(mechanicInput);
              }
            }}
            placeholder="例: action/dodge-roll"
          />
          <button type="button" className="btn-outline" onClick={() => addMechanic(mechanicInput)}>追加</button>
          <datalist id="ludus-mechanics">
            {MECHANICS.map((item) => (
              <option key={item.id} value={item.id}>{item.nameJa}</option>
            ))}
          </datalist>
        </div>
        {mechanicIds.length > 0 && (
          <div className="tags-row">
            {mechanicIds.map((id) => (
              <button
                key={id}
                type="button"
                className="tag mechanic-chip"
                title="クリックで削除"
                onClick={() => setMechanicIds((current) => current.filter((item) => item !== id))}
              >
                {MECHANIC_NAME[id] || id} ×
              </button>
            ))}
          </div>
        )}
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
              {record.polarity === 'like' && '👍 '}
              {record.polarity === 'dislike' && '👎 '}
              {SENTIMENTS[record.sentiment]}
            </span>
          </div>
          <p className="record-comment">{record.comment}</p>
          <div className="tags-row">
            {record.mechanicIds?.map((id) => (
              <span className="tag mechanic-chip" key={id}>{MECHANIC_NAME[id] || id}</span>
            ))}
            {record.tags?.map((tag) => <span className="tag" key={tag}>{tag}</span>)}
          </div>
        </article>
      )}
    />
  );
}
