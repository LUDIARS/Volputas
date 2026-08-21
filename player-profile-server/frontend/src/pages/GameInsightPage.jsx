import { useCallback, useEffect, useState } from 'react';
import { localApi } from '../lib/localApi';
import { HotspotChart } from '@volputas/charts';
import { STAMP_BY_ID } from '../lib/emotionStamps';

// ゲーム洞察 (spec/feature/game-insight.md): 同じゲームを遊んだ全プレイヤー
// (このデータリポジトリに居る本人 + 取り込んだ他人) の感情曲線を絶対時間の
// 共通軸に載せ、ホットスポット (盛り上がり/つまずき) と脱落点を決定的に集計し、
// 任意で Anatomia × 画面録画フレームを添えて LLM に改善ポイントを書かせる。
const BASE = '/api/local/game-insights';

function percent(position) {
  return position === null || position === undefined ? '－' : `${Math.round(position * 100)}%`;
}

function number(value, digits = 2) {
  return value === null || value === undefined ? '－' : Number(value).toFixed(digits);
}

function clock(seconds) {
  if (!Number.isFinite(seconds)) return '－';
  const rounded = Math.max(0, Math.round(seconds));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}

function stampSummary(counts) {
  const parts = Object.entries(counts || {}).map(([id, count]) => `${STAMP_BY_ID[id]?.emoji ?? id}${count}人`);
  return parts.length > 0 ? parts.join(' ') : '－';
}

const KIND_LABEL = { hype: '盛り上がり', pain: 'つまずき' };

/** @implements SPEC-GAME-INSIGHT */
export default function GameInsightPage() {
  const [games, setGames] = useState([]);
  const [insights, setInsights] = useState([]);
  const [status, setStatus] = useState(null);
  const [selectedTitle, setSelectedTitle] = useState('');
  const [current, setCurrent] = useState(null);
  const [captureCandidates, setCaptureCandidates] = useState([]);
  const [anatomiaProject, setAnatomiaProject] = useState('');
  const [captureSessionId, setCaptureSessionId] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const reload = useCallback(async () => {
    const [gameData, insightData, statusData] = await Promise.all([
      localApi(`${BASE}/games`),
      localApi(BASE),
      localApi(`${BASE}/status`),
    ]);
    setGames(gameData);
    setInsights(insightData);
    setStatus(statusData);
    if (!selectedTitle && gameData.length > 0) setSelectedTitle(gameData[0].gameTitle);
  }, [selectedTitle]);

  useEffect(() => {
    reload().catch((reason) => setError(reason.message));
  }, [reload]);

  useEffect(() => {
    setCurrent(insights.find((insight) => insight.gameTitle === selectedTitle) || null);
  }, [insights, selectedTitle]);

  useEffect(() => {
    let active = true;
    setCaptureSessionId('');
    if (!current) {
      setCaptureCandidates([]);
      return () => { active = false; };
    }
    setCaptureCandidates([]);
    localApi(`${BASE}/${current.id}/capture-sessions`)
      .then((candidates) => { if (active) setCaptureCandidates(candidates); })
      .catch(() => { if (active) setCaptureCandidates([]); });
    return () => { active = false; };
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedGame = games.find((game) => game.gameTitle === selectedTitle) || null;

  async function analyze() {
    setBusy('analyze');
    setError('');
    setNotice('');
    try {
      const record = await localApi(`${BASE}/analyze`, { method: 'POST', body: { gameTitle: selectedTitle } });
      setNotice(`${record.analysis.playerCount} 人 / ${record.analysis.sessionCount} セッションからホットスポットを集計しました。`);
      await reload();
      setCurrent(record);
    } catch (reason) {
      setError(reason.code === 'GAME_INSIGHT_INSUFFICIENT_SESSIONS'
        ? 'このゲームの感情曲線が 2 件未満です。他のプレイヤーの記録を取り込むか、もう一度プレイして感情曲線を残してから集計してください。'
        : reason.message);
    } finally {
      setBusy('');
    }
  }

  async function propose() {
    if (!current) return;
    setBusy('propose');
    setError('');
    try {
      const record = await localApi(`${BASE}/${current.id}/propose`, {
        method: 'POST',
        body: { anatomiaProject: anatomiaProject.trim() || undefined, captureSessionId: captureSessionId || undefined },
      });
      setCurrent(record);
      await reload();
    } catch (reason) {
      if (reason.code === 'LLM_NOT_CONFIGURED') {
        setError('AI 提案を実行できません。サーバで Claude CLI (claude) を使えるようにするか、VOLPUTAS_LLM_BACKEND=anthropic と ANTHROPIC_API_KEY を設定してください。');
      } else if (reason.code === 'ANATOMIA_NOT_CONFIGURED') {
        setError('Anatomia CLI が設定されていません。サーバの VOLPUTAS_ANATOMIA_CLI に anatomia.mjs の絶対パスを設定するか、プロジェクト名を空にして実行してください。');
      } else if (reason.code === 'GAME_INSIGHT_STALE') {
        setError('元の感情曲線が変更されています。先に「再集計」を実行してください。');
      } else {
        setError(reason.message);
      }
    } finally {
      setBusy('');
    }
  }

  const analysis = current?.analysis;
  const proposalOutdated = Boolean(current?.proposal && current.proposal.sourceRevision !== current.sourceRevision);

  return (
    <div>
      <div className="page-header">
        <h2>ゲーム洞察</h2>
        <p>
          同じゲームを遊んだ全プレイヤー (このデータの本人と取り込んだ他人の記録) の感情曲線を、
          最長セッションを基準にした絶対時間の共通軸に載せ、盛り上がり・つまずき (ホットスポット) と
          セッションが途切れる位置 (脱落点) をプレイヤー 1 人 1 票で集計します。
          集計は決定的で、AI 改善提案は任意の派生物です。
        </p>
      </div>
      {error && <div className="error-message">{error}</div>}
      {notice && <div className="success-message">{notice}</div>}

      <div className="capture-start-card">
        <label htmlFor="game-insight-game">ゲーム</label>
        <select
          id="game-insight-game"
          value={selectedTitle}
          onChange={(event) => setSelectedTitle(event.target.value)}
        >
          {games.length === 0 && <option value="">感情曲線がまだありません</option>}
          {games.map((game) => (
            <option key={game.gameTitle} value={game.gameTitle}>
              {game.gameTitle} ({game.playerCount} 人 / {game.sessionCount} セッション)
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!selectedTitle || busy !== '' || (selectedGame?.sessionCount ?? 0) < 2}
          onClick={analyze}
        >
          {busy === 'analyze' ? '集計中…' : current ? '再集計' : 'ホットスポットを集計'}
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
              {analysis.playerCount} 人 / {analysis.sessionCount} セッション ・ 基準長 {clock(analysis.referenceLengthSeconds)} ・ 集計 {new Date(current.provenance.analyzedAt).toLocaleString()} ・ {current.provenance.extractor}
            </span>
          </div>
          {analysis.singlePlayer && (
            <p className="capture-record-meta">プレイヤーが 1 人だけなので、横断統計ではなく本人の傾向です。他のプレイヤーの感情曲線を取り込むと横断になります。</p>
          )}
          <HotspotChart analysis={analysis} />
          <div className="narrative-arc-stats">
            <div><span>ホットスポット</span><strong>{analysis.hotspots.length}</strong><small>盛り上がり {analysis.hotspots.filter((spot) => spot.kind === 'hype').length} / つまずき {analysis.hotspots.filter((spot) => spot.kind === 'pain').length}</small></div>
            <div><span>脱落点</span><strong>{analysis.dropouts.length}</strong><small>時刻軸セッション {analysis.timedSessionCount} 件</small></div>
            <div><span>完走</span><strong>{analysis.completion.share === null ? '－' : percent(analysis.completion.share)}</strong><small>{analysis.completion.sessionCount} セッション / {analysis.completion.playerCount} 人</small></div>
            <div><span>プレイヤー</span><strong>{analysis.playerCount}</strong><small>{analysis.players.map((player) => `${player.label}×${player.sessionCount}`).join(' ')}</small></div>
          </div>

          <h3>ホットスポット</h3>
          {analysis.hotspots.length === 0 && <p className="capture-record-meta">複数プレイヤーが揃って反応した区間はまだ見つかりません。</p>}
          {analysis.hotspots.length > 0 && (
            <table className="narrative-arc-sessions">
              <thead>
                <tr><th>位置</th><th>種別</th><th>score</th><th>感情価 / 強さ</th><th>人数</th><th>一致度</th><th>スタンプ</th><th>代表コメント</th></tr>
              </thead>
              <tbody>
                {analysis.hotspots.map((spot) => (
                  <tr key={spot.bin}>
                    <td>{percent(spot.position)}<br /><small>{clock(spot.position * analysis.referenceLengthSeconds)}</small></td>
                    <td>{KIND_LABEL[spot.kind] || spot.kind}<br /><small>{spot.reasons.join(', ')}</small></td>
                    <td>{number(spot.score)}</td>
                    <td>{number(spot.valence, 1)} / {number(spot.arousal, 1)}</td>
                    <td>{spot.playerCount}</td>
                    <td>{number(spot.agreement)}</td>
                    <td>{stampSummary(spot.stampPlayers)}</td>
                    <td>{spot.quotes.map((quote, index) => <div key={index}><small>{quote.player}:</small> {quote.comment}</div>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h3>脱落点</h3>
          {analysis.dropouts.length === 0 && <p className="capture-record-meta">途中で終わった時刻軸セッションはありません (記憶スケッチは脱落統計に入りません)。</p>}
          {analysis.dropouts.length > 0 && (
            <table className="narrative-arc-sessions">
              <thead>
                <tr><th>位置</th><th>終了セッション</th><th>人数</th><th>割合</th><th>終了直前の感情価</th><th>直前のコメント</th></tr>
              </thead>
              <tbody>
                {analysis.dropouts.map((dropout) => (
                  <tr key={dropout.bin}>
                    <td>{percent(dropout.position)}<br /><small>{clock(dropout.position * analysis.referenceLengthSeconds)}</small></td>
                    <td>{dropout.sessionCount}</td>
                    <td>{dropout.playerCount}</td>
                    <td>{percent(dropout.share)}</td>
                    <td>{number(dropout.exitValence, 1)}</td>
                    <td>{(dropout.quotes || []).map((quote, index) => <div key={index}><small>{quote.player}:</small> {quote.comment}</div>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h3>AI 改善提案</h3>
          <div className="game-insight-propose">
            <label className="profile-field">
              <span>Anatomia プロジェクト名 (任意)</span>
              <input
                value={anatomiaProject}
                onChange={(event) => setAnatomiaProject(event.target.value)}
                placeholder="例: my-game (事前に anatomia project add / analyze 済み)"
                disabled={!status?.anatomia?.configured}
              />
              {!status?.anatomia?.configured && <small>サーバに VOLPUTAS_ANATOMIA_CLI が未設定のためコード位置は付きません。</small>}
            </label>
            <label className="profile-field">
              <span>キャプチャセッション (任意: ゲームマーカーと画面フレームの出所)</span>
              <select value={captureSessionId} onChange={(event) => setCaptureSessionId(event.target.value)}>
                <option value="">自動 (画面録画のある自分のセッションを優先)</option>
                {captureCandidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {new Date(candidate.startedAt).toLocaleString()} ・ {candidate.linked ? '曲線元' : '同じゲーム'} ・ 画面録画 {candidate.hasScreenRecording ? 'あり' : 'なし'} ・ game マーカー {candidate.gameMarkerCount}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="evaluation-llm-notice">
            AI 改善提案は、この集計結果と焦点のコメント・ゲームマーカー・Anatomia のコード位置・画面録画のフレーム画像を
            LLM (Claude) に送信して生成します。他の記録や認証情報は含みません。フレームは生成後に削除されます。
          </p>
          <div className="evaluation-actions">
            <button type="button" className="btn-outline" disabled={busy !== '' || !status?.evaluation?.configured} onClick={propose}>
              {busy === 'propose' ? 'AI 提案中…' : current.proposal ? (proposalOutdated ? 'AI 提案を更新 (再集計後未反映)' : 'AI 提案を更新') : 'AI に改善ポイントを提案させる'}
            </button>
          </div>
          {current.proposal && (
            <div className="evaluation-box">
              <div className="evaluation-meta">
                <span className="tag">{current.proposal.model}</span>
                <span className="tag">{new Date(current.proposal.generatedAt).toLocaleString()}</span>
                <span className="tag">焦点 {current.proposal.focusCount}</span>
                <span className="tag">コード位置 {current.proposal.codeLocationCount}</span>
                <span className="tag">フレーム {current.proposal.frameCount}</span>
                {current.proposal.anatomiaProject && <span className="tag">Anatomia: {current.proposal.anatomiaProject}</span>}
                {proposalOutdated && <span className="tag">再集計前の提案</span>}
              </div>
              <pre className="evaluation-text">{current.proposal.text}</pre>
            </div>
          )}
        </div>
      )}
      {!analysis && selectedGame && selectedGame.sessionCount >= 2 && (
        <div className="empty-state">まだ集計していません。「ホットスポットを集計」を押してください。</div>
      )}
    </div>
  );
}
