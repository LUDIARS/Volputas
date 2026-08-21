import { useCallback, useEffect, useState } from 'react';
import { localApi } from '../lib/localApi';
import { NarrativeArcChart } from '@volputas/charts';
import { STAMP_BY_ID } from '../lib/emotionStamps';

// ナラティブアーク (spec/feature/narrative-arc.md): 同じプレイヤー (このローカル
// データの本人) が同じゲームで残した感情曲線を複数まとめ、平均アーク・形状・
// ピーク/谷/終端・回を重ねた変化を決定的に集計し、任意で LLM に解説させる。
const BASE = '/api/local/narrative-arcs';

function percent(position) {
  return position === null || position === undefined ? '－' : `${Math.round(position * 100)}%`;
}

function number(value, digits = 2) {
  return value === null || value === undefined ? '－' : Number(value).toFixed(digits);
}

function stampSummary(counts) {
  const parts = Object.entries(counts || {}).map(([id, count]) => `${STAMP_BY_ID[id]?.emoji ?? id}${count}`);
  return parts.length > 0 ? parts.join(' ') : '－';
}

/** @implements SPEC-NARRATIVE-ARC */
export default function NarrativeArcPage() {
  const [games, setGames] = useState([]);
  const [arcs, setArcs] = useState([]);
  const [status, setStatus] = useState(null);
  const [selectedTitle, setSelectedTitle] = useState('');
  const [current, setCurrent] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const reload = useCallback(async () => {
    const [gameData, arcData, statusData] = await Promise.all([
      localApi(`${BASE}/games`),
      localApi(BASE),
      localApi(`${BASE}/status`),
    ]);
    setGames(gameData);
    setArcs(arcData);
    setStatus(statusData);
    if (!selectedTitle && gameData.length > 0) setSelectedTitle(gameData[0].gameTitle);
  }, [selectedTitle]);

  useEffect(() => {
    reload().catch((reason) => setError(reason.message));
  }, [reload]);

  useEffect(() => {
    const existing = arcs.find((arc) => arc.gameTitle === selectedTitle) || null;
    setCurrent(existing);
  }, [arcs, selectedTitle]);

  const selectedGame = games.find((game) => game.gameTitle === selectedTitle) || null;

  async function analyze() {
    setBusy('analyze');
    setError('');
    setNotice('');
    try {
      const record = await localApi(`${BASE}/analyze`, { method: 'POST', body: { gameTitle: selectedTitle } });
      setNotice(`${record.analysis.sessionCount} セッションからアークを集計しました。`);
      await reload();
      setCurrent(record);
    } catch (reason) {
      setError(reason.code === 'NARRATIVE_ARC_INSUFFICIENT_SESSIONS'
        ? 'このゲームの感情曲線が 2 件未満です。同じゲームをもう一度プレイして感情曲線を残してから集計してください。'
        : reason.message);
    } finally {
      setBusy('');
    }
  }

  async function evaluate() {
    if (!current) return;
    setBusy('evaluate');
    setError('');
    try {
      const record = await localApi(`${BASE}/${current.id}/evaluate`, { method: 'POST', body: {} });
      setCurrent(record);
      await reload();
    } catch (reason) {
      if (reason.code === 'LLM_NOT_CONFIGURED') {
        setError('AI 解説を実行できません。サーバで Claude CLI (claude) を使えるようにするか、VOLPUTAS_LLM_BACKEND=anthropic と ANTHROPIC_API_KEY を設定してください。');
      } else if (reason.code === 'NARRATIVE_ARC_STALE') {
        setError('元の感情曲線が変更されています。先に「再集計」を実行してください。');
      } else {
        setError(reason.message);
      }
    } finally {
      setBusy('');
    }
  }

  const analysis = current?.analysis;
  const evaluationOutdated = Boolean(current?.evaluation
    && (current.evaluation.sourceRevision !== current.sourceRevision
      || JSON.stringify(current.evaluation.sourceRecordIds) !== JSON.stringify(current.sourceRecordIds)));

  return (
    <div>
      <div className="page-header">
        <h2>ナラティブアーク</h2>
        <p>
          同じゲームを何度かプレイして残した感情曲線 (動画・記憶スケッチ・キャプチャ由来のいずれも) を、
          進行 0〜100% の共通軸に正規化して重ね、平均アークの形・ピークと谷・終端・回を重ねた変化を集計します。
          対象は 1 つのゲーム × このデータの本人だけです。
        </p>
      </div>
      {error && <div className="error-message">{error}</div>}
      {notice && <div className="success-message">{notice}</div>}

      <div className="capture-start-card">
        <label htmlFor="narrative-arc-game">ゲーム</label>
        <select
          id="narrative-arc-game"
          value={selectedTitle}
          onChange={(event) => setSelectedTitle(event.target.value)}
        >
          {games.length === 0 && <option value="">感情曲線がまだありません</option>}
          {games.map((game) => (
            <option key={game.gameTitle} value={game.gameTitle}>
              {game.gameTitle} ({game.sessionCount} セッション)
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!selectedTitle || busy !== '' || (selectedGame?.sessionCount ?? 0) < 2}
          onClick={analyze}
        >
          {busy === 'analyze' ? '集計中…' : current ? '再集計' : 'アークを集計'}
        </button>
        {selectedGame && selectedGame.sessionCount < 2 && (
          <span className="capture-record-meta">2 セッション以上で集計できます。</span>
        )}
      </div>

      {analysis && (
        <div className="capture-record-card">
          <div className="capture-record-head">
            <strong>{current.gameTitle}</strong>
            <span className="capture-record-meta">
              {analysis.sessionCount} セッション ・ 集計 {new Date(current.provenance.analyzedAt).toLocaleString()} ・ {current.provenance.extractor}
            </span>
          </div>
          <NarrativeArcChart analysis={analysis} />
          <div className="narrative-arc-stats">
            <div><span>形状</span><strong>{analysis.shape.label}</strong>{analysis.shape.correlation !== null && <small>相関 {number(analysis.shape.correlation)}</small>}</div>
            <div><span>ピーク</span><strong>{analysis.peak ? `${percent(analysis.peak.position)} / ${number(analysis.peak.valence, 1)}` : '－'}</strong></div>
            <div><span>谷</span><strong>{analysis.valley ? `${percent(analysis.valley.position)} / ${number(analysis.valley.valence, 1)}` : '－'}</strong></div>
            <div><span>終端</span><strong>{number(analysis.ending, 1)}</strong><small>ピーク・エンド {number(analysis.peakEnd, 1)}</small></div>
            <div><span>一貫性</span><strong>{number(analysis.consistency)}</strong><small>セッション間の平均相関</small></div>
            <div><span>回を重ねた傾向</span><strong>{analysis.trend.slope === null ? '－' : `${analysis.trend.slope > 0 ? '+' : ''}${number(analysis.trend.slope)}/回`}</strong><small>平均感情価の傾き</small></div>
          </div>
          {analysis.shape.candidates?.length > 1 && (
            <p className="capture-record-meta">
              次点: {analysis.shape.candidates.slice(1, 3).map((candidate) => `${candidate.label} (${number(candidate.correlation)})`).join(' / ')}
            </p>
          )}
          <table className="narrative-arc-sessions">
            <thead>
              <tr>
                <th>#</th><th>セッション</th><th>種別</th><th>記録数</th><th>平均感情価</th><th>ピーク位置</th><th>スタンプ</th><th>申告アーク</th>
              </tr>
            </thead>
            <tbody>
              {analysis.sessions.map((session, index) => (
                <tr key={session.recordId}>
                  <td>{index + 1}</td>
                  <td>{session.sessionLabel || '名称なし'}<br /><small>{session.createdAt ? new Date(session.createdAt).toLocaleDateString() : ''}</small></td>
                  <td>{session.mode}</td>
                  <td>{session.summary.entryCount}</td>
                  <td>{number(session.summary.meanValence)}</td>
                  <td>{percent(session.summary.peakPosition)}</td>
                  <td>{stampSummary(session.summary.stampCounts)}</td>
                  <td>{session.declaredArc || '－'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="evaluation-llm-notice">
            AI 解説は、この集計結果と対象セッションのスタンプ・メモを LLM (Claude) に送信して生成します。
            他の記録や認証情報は含みません。
          </p>
          <div className="evaluation-actions">
            <button type="button" className="btn-outline" disabled={busy !== '' || !status?.evaluation?.configured} onClick={evaluate}>
              {busy === 'evaluate' ? 'AI 解説中…' : current.evaluation ? (evaluationOutdated ? 'AI 解説を更新 (再集計後未反映)' : 'AI 解説を更新') : 'AI でこのアークを解説'}
            </button>
          </div>
          {current.evaluation && (
            <div className="evaluation-box">
              <div className="evaluation-meta">
                <span className="tag">{current.evaluation.model}</span>
                <span className="tag">{new Date(current.evaluation.evaluatedAt).toLocaleString()}</span>
                {evaluationOutdated && <span className="tag">再集計前の解説</span>}
              </div>
              <pre className="evaluation-text">{current.evaluation.text}</pre>
            </div>
          )}
        </div>
      )}
      {!analysis && selectedGame && selectedGame.sessionCount >= 2 && (
        <div className="empty-state">まだ集計していません。「アークを集計」を押してください。</div>
      )}
    </div>
  );
}
