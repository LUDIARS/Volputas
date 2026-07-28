import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import '../styles/impression.css';

const REACTION_LABELS = Object.freeze({
  comment: 'コメント',
  positive: 'ここ良かった',
  negative: 'ここ悪かった',
});

function formatDuration(milliseconds) {
  const seconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export default function ImpressionPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const videoRef = useRef(null);
  const [impression, setImpression] = useState(null);
  const [reactions, setReactions] = useState([]);
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [analysisMessage, setAnalysisMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api(`/api/v1/impressions/${encodeURIComponent(id)}`);
      const loadedImpression = response.data;
      setImpression(loadedImpression);
      if (loadedImpression.assets?.some((asset) => asset.kind === 'video')) {
        const reactionResponse = await api(`/api/v1/impressions/${encodeURIComponent(id)}/reactions`);
        setReactions(reactionResponse.data);
      } else {
        setReactions([]);
      }
    } catch (requestError) {
      setError(requestError.message || 'レビューを読み込めませんでした。');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function addReaction(kind) {
    const content = comment.trim() || REACTION_LABELS[kind];
    const videoOffsetMs = Math.round((videoRef.current?.currentTime || 0) * 1000);
    setBusy(true);
    setError('');
    try {
      const response = await api(`/api/v1/impressions/${encodeURIComponent(id)}/reactions`, {
        method: 'POST',
        body: { video_offset_ms: videoOffsetMs, kind, content },
      });
      setReactions((current) => [...current, response.data]
        .sort((left, right) => left.video_offset_ms - right.video_offset_ms));
      setComment('');
    } catch (requestError) {
      setError(requestError.message || 'スタンプを記録できませんでした。');
    } finally {
      setBusy(false);
    }
  }

  async function removeReaction(reactionId) {
    setBusy(true);
    setError('');
    try {
      await api(`/api/v1/impressions/${encodeURIComponent(id)}/reactions/${encodeURIComponent(reactionId)}`, {
        method: 'DELETE',
      });
      setReactions((current) => current.filter((reaction) => reaction.id !== reactionId));
    } catch (requestError) {
      setError(requestError.message || 'スタンプを削除できませんでした。');
    } finally {
      setBusy(false);
    }
  }

  function seek(videoOffsetMs) {
    if (!videoRef.current) return;
    videoRef.current.currentTime = videoOffsetMs / 1000;
    videoRef.current.play().catch((playError) => {
      if (playError.name !== 'NotAllowedError') setError(`動画を再生できませんでした: ${playError.message}`);
    });
  }

  async function downloadRawData() {
    setBusy(true);
    setError('');
    try {
      const response = await api(`/api/v1/impressions/${encodeURIComponent(id)}/reactions/raw`);
      const url = URL.createObjectURL(new Blob(
        [`${JSON.stringify(response.data, null, 2)}\n`],
        { type: 'application/json;charset=utf-8' }
      ));
      const link = document.createElement('a');
      link.href = url;
      link.download = `volputas-reactions-${id}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (requestError) {
      setError(requestError.message || 'raw dataを出力できませんでした。');
    } finally {
      setBusy(false);
    }
  }

  async function createTimeline() {
    setBusy(true);
    setError('');
    setAnalysisMessage('');
    try {
      const response = await api(`/api/v1/impressions/${encodeURIComponent(id)}/reactions/timeline`, {
        method: 'POST',
        body: { bin_ms: 30_000 },
      });
      setAnalysisMessage(`感情曲線を更新しました（timeline ${response.data.id}）。`);
    } catch (requestError) {
      setError(requestError.message || '感情曲線を生成できませんでした。');
    } finally {
      setBusy(false);
    }
  }

  async function removeImpression() {
    if (!window.confirm('このレビューと動画を削除しますか？')) return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/v1/impressions/${encodeURIComponent(id)}`, { method: 'DELETE' });
      navigate('/', { replace: true });
    } catch (requestError) {
      setError(requestError.message || 'レビューを削除できませんでした。');
      setBusy(false);
    }
  }

  if (loading) return <div className="loading-spinner">レビューを読み込み中…</div>;
  if (!impression) return <div className="error-message">{error || 'レビューが見つかりません。'}</div>;

  const videoAsset = impression.assets?.find((asset) => asset.kind === 'video');
  const videoReady = impression.status === 'ready' && videoAsset?.status === 'ready' && videoAsset.delivery?.url;

  return (
    <section className="impression-page">
      <div className="impression-heading">
        <div>
          <Link to="/">← ダッシュボード</Link>
          <h2>ゲーム動画のレビュー</h2>
          <p className="impression-muted">{new Date(impression.captured_at).toLocaleString('ja-JP')} · {impression.status}</p>
        </div>
        <div className="impression-actions">
          <button className="btn-outline" type="button" disabled={busy} onClick={load}>更新</button>
          <button className="btn-danger" type="button" disabled={busy} onClick={removeImpression}>削除</button>
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}
      {impression.rejection_reason && <div className="error-message">{impression.rejection_reason}</div>}

      <div className="card impression-copy">
        <p>{impression.text || '全体の感想はありません。'}</p>
        <dl className="impression-metrics">
          <div><dt>動画時間</dt><dd>{formatDuration(videoAsset?.duration_ms || impression.playtime?.elapsed_ms)}</dd></div>
          <div><dt>セッション</dt><dd>{impression.session_id}</dd></div>
        </dl>
      </div>

      <div className="impression-assets">
        {(impression.assets || []).map((asset) => (
          <article className="card" key={asset.id}>
            <header><h3>{asset.kind === 'video' ? 'プレイ動画' : 'スクリーンショット'}</h3><span className="tag">{asset.status}</span></header>
            {asset.status === 'ready' && asset.kind === 'screenshot' && asset.delivery?.url && (
              <img src={asset.delivery.url} alt="ゲームのスクリーンショット" />
            )}
            {asset.status === 'ready' && asset.kind === 'video' && asset.delivery?.url && (
              <video ref={videoRef} controls preload="metadata" poster={asset.thumbnail?.url || undefined}>
                <source src={asset.delivery.url} type={asset.delivery.mime_type || 'video/mp4'} />
              </video>
            )}
            {asset.status !== 'ready' && <p className="impression-muted">メディアを処理しています。しばらくしてから更新してください。</p>}
          </article>
        ))}
      </div>

      {videoAsset && (
        <section className="card reaction-panel">
          <div><h3>感情が動いたポイント</h3><p className="impression-muted">動画をその位置まで再生して、本人の反応を記録します。</p></div>
          <textarea rows={3} maxLength={2000} value={comment} disabled={!videoReady || busy} onChange={(event) => setComment(event.target.value)} placeholder="この場面についてのコメント（任意）" />
          <div className="reaction-buttons">
            <button className="btn-outline" type="button" disabled={!videoReady || busy || !comment.trim()} onClick={() => addReaction('comment')}>コメントを記録</button>
            <button className="reaction-positive" type="button" disabled={!videoReady || busy} onClick={() => addReaction('positive')}>ここ良かった</button>
            <button className="reaction-negative" type="button" disabled={!videoReady || busy} onClick={() => addReaction('negative')}>ここ悪かった</button>
          </div>
          <div className="reaction-analysis">
            <button className="btn-outline" type="button" disabled={busy || reactions.length === 0} onClick={downloadRawData}>raw JSONを保存</button>
            <button className="btn-accent" type="button" disabled={busy || reactions.length === 0} onClick={createTimeline}>感情曲線を生成</button>
            {analysisMessage && <span>{analysisMessage}</span>}
          </div>
          <ol className="reaction-list">
            {reactions.map((reaction) => (
              <li key={reaction.id} className={`reaction-${reaction.kind}`}>
                <button className="reaction-seek" type="button" onClick={() => seek(reaction.video_offset_ms)}>{formatDuration(reaction.video_offset_ms)}</button>
                <span className="reaction-kind">{REACTION_LABELS[reaction.kind]}</span>
                <span className="reaction-content">{reaction.content}</span>
                <button className="reaction-delete" type="button" disabled={busy} onClick={() => removeReaction(reaction.id)}>削除</button>
              </li>
            ))}
          </ol>
          {reactions.length === 0 && <p className="impression-muted">まだスタンプはありません。</p>}
        </section>
      )}
    </section>
  );
}
