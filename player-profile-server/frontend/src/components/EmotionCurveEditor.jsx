import { useState } from 'react';
import { EMOTION_STAMPS, STAMP_BY_ID } from '../lib/emotionStamps';
import { useProfileClient } from '../lib/profileClient';

// Inline editor for a saved emotion curve
// (spec/feature/emotion-capture-companion.md §感情曲線の編集). Capture-derived
// curves arrive as machine drafts (one entry per utterance / one-tap marker);
// the player corrects the affect, drops noise, adds what the transcript
// missed and annotates. Identity (mode, media, capture session) is not
// editable — the server ignores it anyway.
function toForm(record) {
  return {
    gameTitle: record.gameTitle || '',
    sessionLabel: record.sessionLabel || '',
    daysAfterPlay: record.daysAfterPlay ?? '',
    totalPlaytimeHours: record.totalPlaytimeHours ?? '',
    sessionPlaytimeMinutes: record.sessionPlaytimeMinutes ?? '',
    playContext: record.playContext || '',
    narrativeArc: record.narrativeArc || '',
    journeyStage: record.journeyStage || '',
    entries: (record.entries || []).map((entry) => ({
      timeSeconds: entry.timeSeconds ?? '',
      position: entry.position ?? '',
      stamp: entry.stamp || null,
      valence: String(entry.valence ?? 0),
      arousal: String(entry.arousal ?? 3),
      comment: entry.comment || '',
      progressLabel: entry.progressLabel || '',
    })),
  };
}

/** @implements SPEC-EMOTION-CAPTURE-COMPANION */
export default function EmotionCurveEditor({ record, onSaved, onCancel }) {
  const client = useProfileClient();
  const [form, setForm] = useState(() => toForm(record));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const isMemory = record.mode === 'memory';

  function update(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  function updateEntry(index, patch) {
    setForm((current) => ({
      ...current,
      entries: current.entries.map((entry, entryIndex) => (entryIndex === index ? { ...entry, ...patch } : entry)),
    }));
  }

  function setStamp(index, stampId) {
    if (!stampId) {
      updateEntry(index, { stamp: null });
      return;
    }
    const stamp = STAMP_BY_ID[stampId];
    updateEntry(index, { stamp: stampId, valence: String(stamp.valence), arousal: String(stamp.arousal) });
  }

  function addEntry() {
    const last = form.entries[form.entries.length - 1];
    setForm((current) => ({
      ...current,
      entries: [...current.entries, {
        timeSeconds: isMemory ? '' : (last ? Number(last.timeSeconds) + 10 : 0),
        position: isMemory ? (last ? last.position : 50) : '',
        stamp: null,
        valence: '0',
        arousal: '3',
        comment: '',
        progressLabel: '',
      }],
    }));
  }

  function removeEntry(index) {
    setForm((current) => ({ ...current, entries: current.entries.filter((_, entryIndex) => entryIndex !== index) }));
  }

  async function submit(event) {
    event.preventDefault();
    if (form.entries.length === 0) {
      setError('記録を 1 件以上残してください。');
      return;
    }
    if (form.entries.some((entry) => !entry.stamp && !entry.comment.trim())) {
      setError('スタンプの無い記録にはメモを入力してください。');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const updated = await client.update('emotion-curves', record.id, form);
      onSaved(updated);
    } catch (reason) {
      setError(reason.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="emotion-curve-editor" onSubmit={submit}>
      <div className="profile-field-row">
        <label className="profile-field"><span>ゲーム名</span><input name="gameTitle" value={form.gameTitle} onChange={update} required /></label>
        <label className="profile-field"><span>セッション名</span><input name="sessionLabel" value={form.sessionLabel} onChange={update} /></label>
      </div>
      <div className="profile-field-row">
        <label className="profile-field"><span>通算プレイ時間 (時間)</span><input name="totalPlaytimeHours" type="number" min="0" step="0.5" value={form.totalPlaytimeHours} onChange={update} /></label>
        <label className="profile-field"><span>このセッションのプレイ時間 (分)</span><input name="sessionPlaytimeMinutes" type="number" min="0" value={form.sessionPlaytimeMinutes} onChange={update} /></label>
      </div>
      <div className="profile-field-row">
        <label className="profile-field"><span>プレイ後の日数</span><input name="daysAfterPlay" type="number" min="0" value={form.daysAfterPlay} onChange={update} /></label>
        <label className="profile-field"><span>ナラティブアーク (申告)</span><input name="narrativeArc" value={form.narrativeArc} onChange={update} placeholder="導入 / 転換点 など" /></label>
      </div>
      <label className="profile-field"><span>プレイ状況</span><textarea name="playContext" rows="2" value={form.playContext} onChange={update} /></label>
      <div className="timeline-editor">
        <div className="timeline-editor-heading">
          <h4>{isMemory ? '位置別の記録' : 'タイミング別の記録'} ({form.entries.length})</h4>
          <button type="button" className="btn-outline" onClick={addEntry}>＋ 記録を追加</button>
        </div>
        {form.entries.map((entry, index) => (
          <div className="timeline-entry" key={index}>
            {isMemory ? (
              <div className="timeline-time position-editor">
                <input aria-label="体験内の位置（%）" type="range" min="0" max="100" value={entry.position} onChange={(event) => updateEntry(index, { position: event.target.value })} />
                <span className="position-value">{entry.position}%</span>
              </div>
            ) : (
              <div className="timeline-time">
                <input aria-label="時刻（秒）" type="number" min="0" step="0.1" value={entry.timeSeconds} onChange={(event) => updateEntry(index, { timeSeconds: event.target.value })} />
              </div>
            )}
            <div className="stamp-chips" role="group" aria-label="スタンプ選択">
              {EMOTION_STAMPS.map((stamp) => (
                <button
                  key={stamp.id}
                  type="button"
                  className={`stamp-chip${entry.stamp === stamp.id ? ' stamp-chip-active' : ''}`}
                  title={stamp.label}
                  onClick={() => setStamp(index, entry.stamp === stamp.id ? null : stamp.id)}
                >
                  {stamp.emoji}
                </button>
              ))}
            </div>
            <select aria-label="感情価" value={entry.valence} onChange={(event) => updateEntry(index, { valence: event.target.value })}>
              {[-2, -1, 0, 1, 2].map((value) => <option key={value} value={value}>感情価 {value > 0 ? `+${value}` : value}</option>)}
            </select>
            <select aria-label="感情の強さ" value={entry.arousal} onChange={(event) => updateEntry(index, { arousal: event.target.value })}>
              {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>強さ {value}</option>)}
            </select>
            <input
              aria-label="進行アンカー"
              className="progress-label-input"
              value={entry.progressLabel}
              onChange={(event) => updateEntry(index, { progressLabel: event.target.value })}
              placeholder="進行アンカー (任意)"
            />
            <textarea
              aria-label="メモ"
              rows="2"
              value={entry.comment}
              onChange={(event) => updateEntry(index, { comment: event.target.value })}
              placeholder={entry.stamp ? 'メモ (任意)' : 'スタンプが無い場合はメモ必須'}
            />
            <button type="button" className="remove-entry" onClick={() => removeEntry(index)}>削除</button>
          </div>
        ))}
      </div>
      {error && <div className="error-message">{error}</div>}
      <div className="evaluation-actions">
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? '保存中…' : '編集を保存'}</button>
        <button type="button" className="btn-outline" onClick={onCancel}>キャンセル</button>
      </div>
    </form>
  );
}
