import { useEffect, useState } from 'react';
import ProfileFeatureLayout from '../components/ProfileFeatureLayout';
import ProfileField from '../components/ProfileField';
import ExperienceScalesInput from '../components/ExperienceScalesInput';
import ScaleSummary from '../components/ScaleSummary';
import VoiceFollowUpPanel from '../components/VoiceFollowUpPanel';
import { useProfileClient } from '../lib/profileClient';
import lexicon from '../data/ludus-lexicon.json';

const INITIAL_FORM = {
  gameTitle: '',
  scopeType: 'game',
  contentName: '',
  playProgress: '',
  sentiment: '',
  polarity: '',
  comment: '',
  tags: '',
};

const PLAY_PROGRESS = {
  early: '序盤',
  middle: '中盤',
  late: '終盤',
  cleared: 'クリア済み',
  'post-clear': 'クリア後もやり込み中',
};

const FOLLOW_UP_LABELS = {
  playProgress: '遊んだ範囲',
  sentiment: '全体の感情',
  polarity: 'スキ / 嫌い',
  reason: '理由',
  highlight: '印象に残った場面',
  ending: '結末・クリアまで',
};

function followUpAnswerText(item) {
  if (item.questionId === 'playProgress') return PLAY_PROGRESS[item.answer] || item.answer;
  if (item.questionId === 'sentiment') return SENTIMENTS[item.answer] || item.answer;
  if (item.questionId === 'polarity') {
    return { like: '👍 スキ', dislike: '👎 嫌い', neither: 'どちらでもない' }[item.answer] || item.answer;
  }
  return item.answer;
}

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
  const [scales, setScales] = useState(null);
  const [mechanicInput, setMechanicInput] = useState('');
  const [records, setRecords] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [followUpRecordId, setFollowUpRecordId] = useState(null);

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
        scales,
      });
      setRecords((current) => [result.record, ...current]);
      setForm(INITIAL_FORM);
      setMechanicIds([]);
      setScales(null);
      setSuccess('ユーザの声を保存しました。足りない情報があれば一問ずつ伺います。');
      setFollowUpRecordId(result.record.id);
    } catch (reason) {
      setError(reason.message);
    } finally {
      setSaving(false);
    }
  }

  function replaceRecord(record) {
    setRecords((current) => current.map((item) => (item.id === record.id ? record : item)));
  }

  const followUpPanel = followUpRecordId && (
    <VoiceFollowUpPanel
      key={followUpRecordId}
      client={client}
      recordId={followUpRecordId}
      onRecordUpdated={replaceRecord}
      onClose={() => setFollowUpRecordId(null)}
    />
  );

  const entryForm = (
    <>
    {followUpPanel}
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
      <ProfileField label="どこまで遊んだか" hint="遊んでいない範囲については質問しません">
        <select name="playProgress" value={form.playProgress} onChange={update} required>
          <option value="" disabled>選択してください</option>
          {Object.entries(PLAY_PROGRESS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </ProfileField>
      <ProfileField label="感情" hint="未回答と「中立」は区別して扱います">
        <select name="sentiment" value={form.sentiment} onChange={update}>
          <option value="">未回答 (あとで答える)</option>
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
      <ExperienceScalesInput value={scales} onChange={setScales} />
      <button className="btn-primary" disabled={saving}>{saving ? '保存中…' : '投稿する'}</button>
    </form>
    </>
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
              <span>
                {record.scopeType === 'content' ? record.contentName : 'ゲーム全体'}
                {PLAY_PROGRESS[record.playProgress] && ` · ${PLAY_PROGRESS[record.playProgress]}`}
              </span>
            </div>
            <span className={`sentiment sentiment-${record.sentiment}`}>
              {record.polarity === 'like' && '👍 '}
              {record.polarity === 'dislike' && '👎 '}
              {record.sentiment === null || record.sentiment === undefined
                ? '感情 未回答'
                : SENTIMENTS[record.sentiment]}
            </span>
          </div>
          <p className="record-comment">{record.comment}</p>
          {record.followUps?.length > 0 && (
            <dl className="follow-up-answers">
              {record.followUps.map((item) => (
                <div key={`${item.questionId}-${item.answeredAt}`}>
                  <dt>{FOLLOW_UP_LABELS[item.questionId] || item.questionId}</dt>
                  <dd>{followUpAnswerText(item)}</dd>
                </div>
              ))}
            </dl>
          )}
          <button
            type="button"
            className="follow-up-resume"
            onClick={() => setFollowUpRecordId(record.id)}
          >
            追加の質問に答える
          </button>
          <div className="tags-row">
            {record.mechanicIds?.map((id) => (
              <span className="tag mechanic-chip" key={id}>{MECHANIC_NAME[id] || id}</span>
            ))}
            {record.tags?.map((tag) => <span className="tag" key={tag}>{tag}</span>)}
          </div>
          <ScaleSummary scales={record.scales} />
        </article>
      )}
    />
  );
}
