import { useCallback, useEffect, useState } from 'react';
import { localApi } from '../lib/localApi';
import CaptureTimelineView from '../components/CaptureTimelineView';

// 感情キャプチャ (spec/feature/emotion-capture-companion.md)。ゲーム合図または
// 手動でセッションを開始し、iPhone コンパニオンのペアリングとタイムラインの
// 確認を行う。感情の記入自体は事後の感情曲線ページで行う。
const BASE = '/api/local/capture-sessions';
const ACTIVE_POLL_MS = 3000;

const STAMP_BUTTONS = [
  { type: 'hype', label: '盛り上がり' },
  { type: 'like', label: 'スキ' },
  { type: 'dislike', label: '嫌い' },
  { type: 'stress', label: 'ストレス' },
];

function formatClock(ms) {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export default function CaptureSessionPage() {
  const [companion, setCompanion] = useState(null);
  const [active, setActive] = useState(null);
  const [records, setRecords] = useState([]);
  const [gameTitle, setGameTitle] = useState('');
  const [pairing, setPairing] = useState(null);
  const [timelines, setTimelines] = useState({});
  const [error, setError] = useState('');
  const shouldPollActiveSession = active !== null;

  const reload = useCallback(async () => {
    const [companionData, activeData, recordData] = await Promise.all([
      localApi(`${BASE}/companion/status`),
      localApi(`${BASE}/active`),
      localApi(BASE),
    ]);
    setCompanion(companionData);
    setActive(activeData);
    setRecords(recordData);
  }, []);

  useEffect(() => {
    reload().catch((reason) => setError(reason.message));
  }, [reload]);

  useEffect(() => {
    if (!shouldPollActiveSession) return undefined;
    const timer = setInterval(() => {
      localApi(`${BASE}/active`)
        .then((data) => {
          setActive(data);
          if (!data) reload().catch((reason) => setError(reason.message));
        })
        .catch((reason) => setError(reason.message));
    }, ACTIVE_POLL_MS);
    return () => clearInterval(timer);
  }, [shouldPollActiveSession, reload]);

  async function run(action) {
    setError('');
    try {
      await action();
      await reload();
    } catch (reason) {
      setError(reason.message);
    }
  }

  const start = () => run(async () => {
    await localApi(BASE, { method: 'POST', body: { gameTitle } });
    setPairing(null);
  });
  const stop = () => run(async () => {
    await localApi(`${BASE}/active/stop`, { method: 'POST', body: {} });
    setPairing(null);
  });
  const mark = (type) => run(() =>
    localApi(`${BASE}/active/markers`, { method: 'POST', body: { type } }));
  const issuePairing = () => run(async () => {
    setPairing(await localApi(`${BASE}/active/pairing`, { method: 'POST', body: {} }));
  });

  async function toggleTimeline(recordId) {
    if (timelines[recordId]) {
      setTimelines((current) => ({ ...current, [recordId]: null }));
      return;
    }
    setError('');
    try {
      const timeline = await localApi(`${BASE}/${recordId}/timeline`);
      setTimelines((current) => ({ ...current, [recordId]: timeline }));
    } catch (reason) {
      setError(reason.message);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h2>感情キャプチャ</h2>
        <p>
          プレイ中のセッションをゲームと同じ時間軸で記録します。ゲームからの合図
          (POST {BASE}/signal) か下のボタンで開始し、iPhone をペアリングすると
          視線・音声・ワンタップ記録がタイムラインに載ります。
        </p>
      </div>
      {error && <div className="error-message">{error}</div>}

      {companion && !companion.enabled && (
        <div className="capture-companion-note">
          iPhone コンパニオン用の待ち受けは無効です。有効にするには
          <code> VOLPUTAS_COMPANION_PORT </code> と TLS 証明書・秘密鍵を設定して
          再起動してください。
        </div>
      )}

      {active ? (
        <div className="capture-active-card">
          <h3>録画中: {active.gameTitle}</h3>
          <div className="capture-active-meta">
            開始 {new Date(active.startedAt).toLocaleTimeString()} ・
            マーカー {active.markers.length} 件 ・
            接続端末 {active.devices.length} 台
          </div>
          <div className="capture-stamp-row">
            {STAMP_BUTTONS.map((stamp) => (
              <button key={stamp.type} type="button" onClick={() => mark(stamp.type)}>
                {stamp.label}
              </button>
            ))}
          </div>
          <div className="capture-active-actions">
            <button type="button" onClick={issuePairing}>iPhone をペアリング</button>
            <button type="button" className="danger" onClick={stop}>セッション終了</button>
          </div>
          {pairing && (
            <div className="capture-pairing">
              <div className="capture-pairing-code">{pairing.code}</div>
              <p>
                iPhone で
                {companion?.enabled && companion.urls.length > 0
                  ? ` ${companion.urls[0]} `
                  : ' コンパニオンページ '}
                を開き、このコードを入力してください
                (有効期限 {new Date(pairing.expiresAtMs).toLocaleTimeString()})。
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="capture-start-card">
          <label htmlFor="capture-game-title">ゲームタイトル</label>
          <input
            id="capture-game-title"
            type="text"
            value={gameTitle}
            onChange={(event) => setGameTitle(event.target.value)}
            placeholder="手動でセッションを開始する場合"
          />
          <button type="button" disabled={!gameTitle.trim()} onClick={start}>
            キャプチャ開始
          </button>
        </div>
      )}

      <h3>過去のセッション</h3>
      {records.length === 0 && <div className="empty-state">まだキャプチャセッションはありません。</div>}
      {records.map((record) => (
        <div key={record.id} className="capture-record-card">
          <div className="capture-record-head">
            <strong>{record.gameTitle}</strong>
            {' '}
            <span className="capture-record-meta">
              {new Date(record.startedAt).toLocaleString()} ・ {record.status}
              {record.endedAt
                ? ` ・ ${formatClock(Date.parse(record.endedAt) - Date.parse(record.startedAt))}`
                : ''}
              ・ マーカー {record.markers.length} 件
              ・ 視線 {record.capture.gazeSampleCount} sample
              {record.capture.audioFileName ? ' ・ 音声あり' : ''}
            </span>
            <button type="button" onClick={() => toggleTimeline(record.id)}>
              {timelines[record.id] ? 'タイムラインを閉じる' : 'タイムラインを見る'}
            </button>
          </div>
          {timelines[record.id] && <CaptureTimelineView timeline={timelines[record.id]} />}
          {timelines[record.id] && record.capture.audioFileName && (
            <audio controls src={`${BASE}/${record.id}/audio`} style={{ width: '100%' }} />
          )}
        </div>
      ))}
    </div>
  );
}
