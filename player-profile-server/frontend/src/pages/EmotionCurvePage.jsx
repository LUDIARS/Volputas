import { useEffect, useMemo, useRef, useState } from 'react';
import EmotionCurveRecordCard from '../components/EmotionCurveRecordCard';
import ProfileFeatureLayout from '../components/ProfileFeatureLayout';
import ProfileField from '../components/ProfileField';
import { EMOTION_STAMPS, STAMP_BY_ID } from '../lib/emotionStamps';
import { useProfileClient } from '../lib/profileClient';

const EMPTY_ENTRY = { timeSeconds: '0', stamp: null, valence: '0', arousal: '3', comment: '' };
const INITIAL_FORM = {
  gameTitle: '',
  daysAfterPlay: '',
  totalPlaytimeHours: '',
  sessionPlaytimeMinutes: '',
  sessionLabel: '',
  playContext: '',
  narrativeArc: '',
  journeyStage: '',
};

const GAME_LOG_TYPES = { json: 'application/json', csv: 'text/csv' };

function gameLogUploadFile(file) {
  if (Object.values(GAME_LOG_TYPES).includes(file.type) || file.type === 'text/plain') {
    return file;
  }
  // Browsers report .log files with an empty MIME type; re-wrap with one the
  // server accepts, inferred from the extension.
  const extension = file.name.split('.').pop().toLowerCase();
  const type = GAME_LOG_TYPES[extension] || 'text/plain';
  return new File([file], file.name, { type });
}

export default function EmotionCurvePage() {
  const client = useProfileClient();
  const [form, setForm] = useState(INITIAL_FORM);
  const [entries, setEntries] = useState([]);
  const [file, setFile] = useState(null);
  const [gameLogFile, setGameLogFile] = useState(null);
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

  function updateEntry(index, patch) {
    setEntries((current) => current.map((entry, entryIndex) =>
      entryIndex === index ? { ...entry, ...patch } : entry));
  }

  function currentVideoTime() {
    if (!videoRef.current) return 0;
    return Math.round(videoRef.current.currentTime * 10) / 10;
  }

  function addStampEntry(stampId) {
    const stamp = STAMP_BY_ID[stampId];
    setEntries((current) => [...current, {
      timeSeconds: String(currentVideoTime()),
      stamp: stampId,
      valence: String(stamp.valence),
      arousal: String(stamp.arousal),
      comment: '',
    }]);
  }

  function setEntryStamp(index, stampId) {
    if (!stampId) {
      updateEntry(index, { stamp: null });
      return;
    }
    const stamp = STAMP_BY_ID[stampId];
    updateEntry(index, {
      stamp: stampId,
      valence: String(stamp.valence),
      arousal: String(stamp.arousal),
    });
  }

  function replaceRecord(updated) {
    setRecords((current) => current.map((record) =>
      record.id === updated.id ? updated : record));
  }

  async function submit(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    if (!file) {
      setError('ゲームプレイ動画を選択してください。');
      return;
    }
    if (entries.length === 0) {
      setError('スタンプまたはメモを 1 件以上記録してください。');
      return;
    }
    const incomplete = entries.some((entry) => !entry.stamp && !entry.comment.trim());
    if (incomplete) {
      setError('スタンプの無い記録にはメモを入力してください。');
      return;
    }
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const result = await client.create('emotion-curves', {
        ...form,
        entries,
        videoFileName: file.name,
        gameLogFileName: gameLogFile ? gameLogFile.name : '',
      });
      try {
        await client.upload('videos', result.record.id, file);
        if (gameLogFile) {
          await client.upload('gamelogs', result.record.id, gameLogUploadFile(gameLogFile));
        }
      } catch (uploadError) {
        throw new Error(`記録は保存しましたがメディアを保存できませんでした: ${uploadError.message}`);
      }
      setRecords((current) => [result.record, ...current]);
      setForm(INITIAL_FORM);
      setEntries([]);
      setFile(null);
      setGameLogFile(null);
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
      <h3>動画へ感情を記録</h3>
      <p className="form-intro">
        動画を再生しながらスタンプをタップすると、その時点の「盛り上がり/スキ/嫌い/ストレス」が記録されます。
        何が良かったか・嫌だったかを言語化できる場合はメモも書いてください。
      </p>
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
      {previewUrl && (
        <div className="stamp-bar" role="group" aria-label="感情スタンプ">
          {EMOTION_STAMPS.map((stamp) => (
            <button
              key={stamp.id}
              type="button"
              className={`stamp-button stamp-${stamp.id}`}
              onClick={() => addStampEntry(stamp.id)}
            >
              <span className="stamp-emoji">{stamp.emoji}</span>
              {stamp.label}
            </button>
          ))}
        </div>
      )}
      <ProfileField label="ゲームログ (任意)" hint=".log / .txt / .json / .csv、最大100MB">
        <input
          type="file"
          accept=".log,.txt,.json,.csv,text/plain,application/json,text/csv"
          onChange={(event) => setGameLogFile(event.target.files[0] || null)}
        />
      </ProfileField>
      <div className="profile-field-row">
        <ProfileField label="通算プレイ時間 (時間)" hint="このゲーム全体を通して">
          <input name="totalPlaytimeHours" type="number" min="0" step="0.5" value={form.totalPlaytimeHours} onChange={update} placeholder="12" />
        </ProfileField>
        <ProfileField label="このセッションのプレイ時間 (分)">
          <input name="sessionPlaytimeMinutes" type="number" min="0" value={form.sessionPlaytimeMinutes} onChange={update} placeholder="60" />
        </ProfileField>
      </div>
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
          <h4>タイミング別の記録</h4>
          <button type="button" className="btn-outline" onClick={() => setEntries((current) => [...current, { ...EMPTY_ENTRY, timeSeconds: String(currentVideoTime()) }])}>
            ＋ メモだけ追加
          </button>
        </div>
        {entries.length === 0 && (
          <p className="form-intro">まだ記録がありません。動画を再生してスタンプをタップしてください。</p>
        )}
        {entries.map((entry, index) => (
          <div className="timeline-entry" key={index}>
            <div className="timeline-time">
              <input
                aria-label="動画時刻（秒）"
                type="number"
                min="0"
                step="0.1"
                value={entry.timeSeconds}
                onChange={(event) => updateEntry(index, { timeSeconds: event.target.value })}
              />
              <button type="button" className="btn-outline" disabled={!file} onClick={() => updateEntry(index, { timeSeconds: String(currentVideoTime()) })}>
                現在位置
              </button>
            </div>
            <div className="stamp-chips" role="group" aria-label="スタンプ選択">
              {EMOTION_STAMPS.map((stamp) => (
                <button
                  key={stamp.id}
                  type="button"
                  className={`stamp-chip${entry.stamp === stamp.id ? ' stamp-chip-active' : ''}`}
                  title={stamp.label}
                  onClick={() => setEntryStamp(index, entry.stamp === stamp.id ? null : stamp.id)}
                >
                  {stamp.emoji}
                </button>
              ))}
            </div>
            <select aria-label="感情の強さ" value={entry.arousal} onChange={(event) => updateEntry(index, { arousal: event.target.value })}>
              {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>強さ {value}</option>)}
            </select>
            <textarea
              aria-label="メモ"
              rows="2"
              value={entry.comment}
              onChange={(event) => updateEntry(index, { comment: event.target.value })}
              placeholder={entry.stamp
                ? '何が良かった/嫌だったか言語化できれば書く (任意)'
                : 'スタンプが無い場合はメモ必須'}
            />
            <button type="button" className="remove-entry" onClick={() => setEntries((current) => current.filter((_, entryIndex) => entryIndex !== index))}>
              削除
            </button>
          </div>
        ))}
      </div>
      <button className="btn-primary" disabled={saving}>{saving ? 'アップロード中…' : '感情曲線を保存'}</button>
    </form>
  );

  return (
    <ProfileFeatureLayout
      title="感情曲線"
      description="ゲームプレイ動画にスタンプとメモで感情を記録し、ペルソナと合わせて AI がナラティブアークを評価します。"
      form={entryForm}
      records={records}
      error={error}
      success={success}
      emptyMessage="感情曲線はまだありません。"
      renderRecord={(record) => (
        <EmotionCurveRecordCard key={record.id} record={record} onRecordUpdated={replaceRecord} />
      )}
    />
  );
}
