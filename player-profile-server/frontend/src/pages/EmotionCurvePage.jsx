import { useEffect, useMemo, useRef, useState } from 'react';
import ProfileFeatureLayout from '../components/ProfileFeatureLayout';
import ProfileField from '../components/ProfileField';
import ProfileMedia from '../components/ProfileMedia';
import { useProfileClient } from '../lib/profileClient';

const EMPTY_ENTRY = { timeSeconds: '0', valence: '0', arousal: '3', comment: '' };
const INITIAL_FORM = {
  gameTitle: '',
  daysAfterPlay: '',
  sessionLabel: '',
  playContext: '',
  narrativeArc: '',
  journeyStage: '',
};

function formatTime(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(value / 60);
  return `${minutes}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
}

export default function EmotionCurvePage() {
  const client = useProfileClient();
  const [form, setForm] = useState(INITIAL_FORM);
  const [entries, setEntries] = useState([{ ...EMPTY_ENTRY }]);
  const [file, setFile] = useState(null);
  const [records, setRecords] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const videoRef = useRef(null);
  const previewUrl = useMemo(() => file ? URL.createObjectURL(file) : '', [file]);

  useEffect(() => {
    client.list('emotion-curves').then(setRecords).catch((reason) => setError(reason.message));
  }, [client]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function update(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  function updateEntry(index, field, value) {
    setEntries((current) => current.map((entry, entryIndex) =>
      entryIndex === index ? { ...entry, [field]: value } : entry));
  }

  function useCurrentTime(index) {
    if (!videoRef.current) return;
    updateEntry(index, 'timeSeconds', Math.round(videoRef.current.currentTime * 10) / 10);
  }

  async function submit(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    if (!file) {
      setError('ゲームプレイ動画を選択してください。');
      return;
    }
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const result = await client.create(
        'emotion-curves',
        { ...form, entries, videoFileName: file.name }
      );
      try {
        await client.upload('videos', result.record.id, file);
      } catch (uploadError) {
        throw new Error(`記録は保存しましたが動画を保存できませんでした: ${uploadError.message}`);
      }
      setRecords((current) => [result.record, ...current]);
      setForm(INITIAL_FORM);
      setEntries([{ ...EMPTY_ENTRY }]);
      setFile(null);
      formElement.reset();
      setSuccess('動画と感情曲線を保存しました。');
    } catch (reason) {
      setError(reason.message);
    } finally {
      setSaving(false);
    }
  }

  const entryForm = (
    <form onSubmit={submit}>
      <h3>動画へ感想を記録</h3>
      <p className="form-intro">動画を再生し、気持ちが動いた時点の時刻・感情・コメントを登録します。</p>
      <ProfileField label="ゲーム名">
        <input name="gameTitle" value={form.gameTitle} onChange={update} required />
      </ProfileField>
      <ProfileField label="ゲームプレイ動画" hint="MP4 / WebM / MOV、最大2GB">
        <input
          type="file"
          accept="video/mp4,video/webm,video/quicktime"
          required
          onChange={(event) => setFile(event.target.files[0] || null)}
        />
      </ProfileField>
      {previewUrl && <video className="emotion-video" ref={videoRef} src={previewUrl} controls />}
      <div className="profile-field-row">
        <ProfileField label="プレイ後の日数">
          <input name="daysAfterPlay" type="number" min="0" value={form.daysAfterPlay} onChange={update} placeholder="0" />
        </ProfileField>
        <ProfileField label="セッション名">
          <input name="sessionLabel" value={form.sessionLabel} onChange={update} placeholder="初回プレイ など" />
        </ProfileField>
      </div>
      <div className="profile-field-row">
        <ProfileField label="ナラティブアーク">
          <input name="narrativeArc" value={form.narrativeArc} onChange={update} placeholder="導入 / 転換点 など" />
        </ProfileField>
        <ProfileField label="ユーザージャーニー">
          <input name="journeyStage" value={form.journeyStage} onChange={update} placeholder="認知 / 習熟 など" />
        </ProfileField>
      </div>
      <ProfileField label="プレイ状況">
        <textarea name="playContext" rows="3" value={form.playContext} onChange={update} />
      </ProfileField>
      <div className="timeline-editor">
        <div className="timeline-editor-heading">
          <h4>タイミング別の感想</h4>
          <button type="button" className="btn-outline" onClick={() => setEntries((current) => [...current, { ...EMPTY_ENTRY }])}>
            ＋ 追加
          </button>
        </div>
        {entries.map((entry, index) => (
          <div className="timeline-entry" key={index}>
            <div className="timeline-time">
              <input
                aria-label="動画時刻（秒）"
                type="number"
                min="0"
                step="0.1"
                value={entry.timeSeconds}
                onChange={(event) => updateEntry(index, 'timeSeconds', event.target.value)}
              />
              <button type="button" className="btn-outline" disabled={!file} onClick={() => useCurrentTime(index)}>
                現在位置
              </button>
            </div>
            <select aria-label="感情価" value={entry.valence} onChange={(event) => updateEntry(index, 'valence', event.target.value)}>
              <option value="-2">強い不快</option>
              <option value="-1">やや不快</option>
              <option value="0">中立</option>
              <option value="1">やや快</option>
              <option value="2">強い快</option>
            </select>
            <select aria-label="感情の強さ" value={entry.arousal} onChange={(event) => updateEntry(index, 'arousal', event.target.value)}>
              {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>強さ {value}</option>)}
            </select>
            <textarea
              aria-label="感想"
              rows="2"
              value={entry.comment}
              onChange={(event) => updateEntry(index, 'comment', event.target.value)}
              required
              placeholder="この瞬間に感じたこと"
            />
            {entries.length > 1 && (
              <button type="button" className="remove-entry" onClick={() => setEntries((current) => current.filter((_, entryIndex) => entryIndex !== index))}>
                削除
              </button>
            )}
          </div>
        ))}
      </div>
      <button className="btn-primary" disabled={saving}>{saving ? 'アップロード中…' : '感情曲線を保存'}</button>
    </form>
  );

  return (
    <ProfileFeatureLayout
      title="感情曲線"
      description="ゲームプレイ動画の特定時点へ感想を紐づけ、ナラティブと体験の流れを記録します。"
      form={entryForm}
      records={records}
      error={error}
      success={success}
      emptyMessage="感情曲線はまだありません。"
      renderRecord={(record) => (
        <article className="card profile-record" key={record.id}>
          <div className="record-heading">
            <div><h4>{record.gameTitle}</h4><span>{record.sessionLabel || 'セッション名なし'}</span></div>
            {record.daysAfterPlay !== null && <span className="tag">プレイ後 {record.daysAfterPlay} 日</span>}
          </div>
          <ProfileMedia
            as="video"
            className="emotion-video"
            kind="videos"
            recordId={record.id}
            controls
            preload="metadata"
          />
          <div className="emotion-timeline">
            {record.entries.map((entry, index) => (
              <div className="emotion-point" key={`${entry.timeSeconds}-${index}`}>
                <strong>{formatTime(entry.timeSeconds)}</strong>
                <span className={`valence valence-${entry.valence}`}>{entry.valence > 0 ? '+' : ''}{entry.valence}</span>
                <p>{entry.comment}</p>
              </div>
            ))}
          </div>
          <div className="tags-row">
            {record.narrativeArc && <span className="tag">Arc: {record.narrativeArc}</span>}
            {record.journeyStage && <span className="tag">Journey: {record.journeyStage}</span>}
          </div>
        </article>
      )}
    />
  );
}
