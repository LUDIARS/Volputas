import { useState } from 'react';
import EmotionCurveEditor from './EmotionCurveEditor';
import ProfileMedia from './ProfileMedia';
import { STAMP_BY_ID } from '../lib/emotionStamps';
import { useProfileClient } from '../lib/profileClient';
import { useRuntimeMode } from '../hooks/useRuntimeMode';

function formatTime(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(value / 60);
  return `${minutes}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
}

/** @implements SPEC-EMOTION-CAPTURE-COMPANION */
export default function EmotionCurveRecordCard({ record, onRecordUpdated }) {
  const client = useProfileClient();
  const { mode } = useRuntimeMode();
  const [evaluating, setEvaluating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [showEvaluation, setShowEvaluation] = useState(false);
  const evaluationStale = Boolean(record.evaluation && record.editedAt
    && Date.parse(record.editedAt) > Date.parse(record.evaluation.evaluatedAt));

  async function evaluate() {
    setEvaluating(true);
    setError('');
    try {
      const data = await client.evaluateEmotionCurve(record.id);
      onRecordUpdated(data.record || data);
      setShowEvaluation(true);
    } catch (reason) {
      setError(reason.code === 'LLM_NOT_CONFIGURED'
        ? 'AI 評価を実行できません。サーバで Claude CLI (claude) を使えるようにするか、VOLPUTAS_LLM_BACKEND=anthropic と ANTHROPIC_API_KEY を設定してください。'
        : reason.message);
    } finally {
      setEvaluating(false);
    }
  }

  return (
    <article className="card profile-record">
      <div className="record-heading">
        <div><h4>{record.gameTitle}</h4><span>{record.sessionLabel || 'セッション名なし'}</span></div>
        {record.daysAfterPlay !== null && record.daysAfterPlay !== undefined && (
          <span className="tag">プレイ後 {record.daysAfterPlay} 日</span>
        )}
      </div>
      {record.mode !== 'memory' && record.mode !== 'capture' && (
        <ProfileMedia
          as="video"
          className="emotion-video"
          kind="videos"
          recordId={record.id}
          controls
          preload="metadata"
        />
      )}
      <div className="emotion-timeline">
        {record.entries.map((entry, index) => {
          const stamp = entry.stamp ? STAMP_BY_ID[entry.stamp] : null;
          const at = record.mode === 'memory'
            ? `${entry.position}%`
            : formatTime(entry.timeSeconds);
          return (
            <div className="emotion-point" key={`${at}-${index}`}>
              <strong>{at}</strong>
              <span className={`valence valence-${entry.valence}`} title={stamp ? stamp.label : undefined}>
                {stamp ? stamp.emoji : `${entry.valence > 0 ? '+' : ''}${entry.valence}`}
              </span>
              <p>
                {entry.progressLabel && <span className="tag">{entry.progressLabel}</span>}
                {entry.comment || (stamp ? ` ${stamp.label}` : '')}
              </p>
            </div>
          );
        })}
      </div>
      <div className="tags-row">
        {record.mode === 'memory' && <span className="tag">記憶スケッチ</span>}
        {record.mode === 'capture' && <span className="tag">キャプチャ由来</span>}
        {record.editCount > 0 && <span className="tag">編集 {record.editCount} 回</span>}
        {record.narrativeArc && <span className="tag">Arc: {record.narrativeArc}</span>}
        {record.journeyStage && <span className="tag">Journey: {record.journeyStage}</span>}
        {record.totalPlaytimeHours !== null && record.totalPlaytimeHours !== undefined && (
          <span className="tag">通算 {record.totalPlaytimeHours} 時間</span>
        )}
        {record.sessionPlaytimeMinutes !== null && record.sessionPlaytimeMinutes !== undefined && (
          <span className="tag">セッション {record.sessionPlaytimeMinutes} 分</span>
        )}
        {record.gameLogFileName && <span className="tag">ログ: {record.gameLogFileName}</span>}
      </div>
      <p className="evaluation-llm-notice">
        AI 評価は、この記録のスタンプ・メモ・プレイ時間・添付ゲームログとペルソナ分析を
        LLM (Claude) に送信して生成します。
      </p>
      {mode === 'local' && editing && (
        <EmotionCurveEditor
          record={record}
          onSaved={(updated) => { onRecordUpdated(updated); setEditing(false); }}
          onCancel={() => setEditing(false)}
        />
      )}
      <div className="evaluation-actions">
        {mode === 'local' && !editing && (
          <button type="button" className="btn-outline" onClick={() => setEditing(true)}>
            記録を編集
          </button>
        )}
        <button type="button" className="btn-outline" disabled={evaluating} onClick={evaluate}>
          {evaluating ? 'AI 評価中…' : record.evaluation ? (evaluationStale ? 'AI 評価を更新 (編集後未評価)' : 'AI 評価を更新') : 'AI でこの感情曲線を評価'}
        </button>
        {record.evaluation && (
          <button type="button" className="btn-outline" onClick={() => setShowEvaluation((value) => !value)}>
            {showEvaluation ? '評価を隠す' : '評価を表示'}
          </button>
        )}
      </div>
      {error && <div className="error-message">{error}</div>}
      {record.evaluation && showEvaluation && (
        <div className="evaluation-box">
          <div className="evaluation-meta">
            <span className="tag">{record.evaluation.model}</span>
            <span className="tag">{new Date(record.evaluation.evaluatedAt).toLocaleString()}</span>
            {record.evaluation.usedGameLog && <span className="tag">ゲームログ参照</span>}
            {!record.evaluation.personaAnalyzedAt && <span className="tag">ペルソナ未反映</span>}
          </div>
          <pre className="evaluation-text">{record.evaluation.text}</pre>
        </div>
      )}
    </article>
  );
}
