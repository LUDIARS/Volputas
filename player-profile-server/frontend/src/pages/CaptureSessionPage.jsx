import { useCallback, useEffect, useState } from 'react';
import { localApi } from '../lib/localApi';
import CaptureReplayView from '../components/CaptureReplayView';
import CaptureDesktopPanel from '../components/CaptureDesktopPanel';
import CaptureRecordingUpload from '../components/CaptureRecordingUpload';
import GazeAnalysisControl from '../components/GazeAnalysisControl';
import { useDesktopCapture } from '../hooks/useDesktopCapture';

// 感情キャプチャ (spec/feature/emotion-capture-companion.md)。ゲーム合図または
// 手動でセッションを開始し、この PC の顔カメラ/マイク/画面録画、iPhone コンパニオン
// のペアリング、事後の分析 (文字起こし・視線推定・感情曲線) とリプレイを行う。
// 感情の記入・編集自体は感情曲線ページ、複数セッションの解析はナラティブアーク
// ページ。
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

function recordSummary(record) {
  const parts = [
    `${new Date(record.startedAt).toLocaleString()} ・ ${record.status}`,
    record.endedAt ? formatClock(Date.parse(record.endedAt) - Date.parse(record.startedAt)) : null,
    `マーカー ${record.markers.length} 件`,
    `視線 ${record.capture.gazeSampleCount} sample${record.capture.gazeSource === 'face-video' ? ' (顔映像から推定)' : ''}`,
    record.capture.audioFileName ? '音声あり' : null,
    record.capture.screenRecording ? '画面録画あり' : null,
    record.capture.faceRecording ? '顔カメラあり' : null,
    record.calibration ? `キャリブレーション ${record.calibration.points.length} 点` : null,
  ];
  return parts.filter(Boolean).join(' ・ ');
}

/** @implements SPEC-EMOTION-CAPTURE-COMPANION */
export default function CaptureSessionPage() {
  const [companion, setCompanion] = useState(null);
  const [analysisStatus, setAnalysisStatus] = useState(null);
  const [active, setActive] = useState(null);
  const [records, setRecords] = useState([]);
  const [gameTitle, setGameTitle] = useState('');
  const [pairing, setPairing] = useState(null);
  const [timelines, setTimelines] = useState({});
  const [busyRecordId, setBusyRecordId] = useState(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const shouldPollActiveSession = active !== null;

  const reload = useCallback(async () => {
    const [companionData, analysisData, activeData, recordData] = await Promise.all([
      localApi(`${BASE}/companion/status`),
      localApi(`${BASE}/analysis/status`),
      localApi(`${BASE}/active`),
      localApi(BASE),
    ]);
    setCompanion(companionData);
    setAnalysisStatus(analysisData);
    setActive(activeData);
    setRecords(recordData);
  }, []);

  const showError = useCallback((message) => setError(message), []);
  const onUploaded = useCallback(({ uploaded }) => {
    if (uploaded.length > 0) {
      setNotice(`録画をアップロードしました (${uploaded.join(', ')})。`);
      reload().catch((reason) => setError(reason.message));
    }
  }, [reload]);
  const capture = useDesktopCapture({ active, onError: showError, onUploaded });

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
    capture.reset();
  });
  // Recorders stop first so their end lands on the session clock, then the
  // session, then the recordings upload against the completed session.
  const stop = () => run(async () => {
    await capture.finish(() => localApi(`${BASE}/active/stop`, { method: 'POST', body: {} }));
    setPairing(null);
  });
  const mark = (type) => run(() =>
    localApi(`${BASE}/active/markers`, { method: 'POST', body: { type } }));
  const issuePairing = () => run(async () => {
    setPairing(await localApi(`${BASE}/active/pairing`, { method: 'POST', body: {} }));
  });

  async function analyze(recordId) {
    setError('');
    setNotice('');
    setBusyRecordId(recordId);
    try {
      await localApi(`${BASE}/${recordId}/analyze`, { method: 'POST', body: {} });
      setNotice('文字起こしと感情スコアを保存しました。');
      await reload();
      if (timelines[recordId]) await refreshTimeline(recordId);
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusyRecordId(null);
    }
  }

  async function createEmotionCurve(recordId) {
    setError('');
    setNotice('');
    setBusyRecordId(recordId);
    try {
      const curve = await localApi(`${BASE}/${recordId}/emotion-curve`, {
        method: 'POST', body: {},
      });
      setNotice(`感情曲線を作成しました (${curve.entries.length} エントリ)。感情曲線ページで編集でき、ペルソナ分析とナラティブアークに反映されます。`);
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusyRecordId(null);
    }
  }

  async function refreshTimeline(recordId) {
    const timeline = await localApi(`${BASE}/${recordId}/timeline`);
    setTimelines((current) => ({ ...current, [recordId]: timeline }));
  }

  async function toggleTimeline(recordId) {
    if (timelines[recordId]) {
      setTimelines((current) => ({ ...current, [recordId]: null }));
      return;
    }
    setError('');
    try {
      await refreshTimeline(recordId);
    } catch (reason) {
      setError(reason.message);
    }
  }

  async function afterMediaChange(recordId, message) {
    setError('');
    setNotice(message);
    await reload();
    if (timelines[recordId]) await refreshTimeline(recordId).catch((reason) => setError(reason.message));
  }

  return (
    <div>
      <div className="page-header">
        <h2>感情キャプチャ</h2>
        <p>
          プレイ中のセッションをゲームと同じ時間軸で記録します。ゲームからの合図
          (POST {BASE}/signal) か下のボタンで開始し、この PC の顔カメラ・マイク・画面録画、
          または iPhone をペアリングして視線・音声・ワンタップ記録をタイムラインに載せます。
          終了後は文字起こし→感情分析、顔映像からの視線推定、画面録画に視線を重ねたリプレイができます。
        </p>
      </div>
      {error && <div className="error-message">{error}</div>}
      {notice && <div className="success-message">{notice}</div>}

      {analysisStatus && !analysisStatus.stt.configured && (
        <div className="capture-companion-note">
          ローカル感情分析 (文字起こし) には VOLPUTAS_STT_URL に whisper-stt サーバの
          URL を設定してください。設定するまで分析ボタンは失敗します
          (視線・マーカーのタイムラインはそのまま使えます)。
        </div>
      )}

      {companion && !companion.enabled && (
        <div className="capture-companion-note">
          iPhone コンパニオン用の待ち受けは無効です。有効にするには
          <code> VOLPUTAS_COMPANION_PORT </code> と TLS 証明書・秘密鍵を設定して
          再起動してください (この PC の録画は設定なしで使えます)。
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
          <CaptureDesktopPanel
            active={active}
            capture={capture}
            onNotice={setNotice}
            onError={setError}
          />
          <div className="capture-active-actions">
            <button type="button" onClick={issuePairing}>iPhone をペアリング</button>
            <button type="button" className="danger" disabled={capture.uploading || capture.starting} onClick={stop}>
              {capture.recording ? 'セッション終了 (録画を停止してアップロード)' : 'セッション終了'}
            </button>
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
          <button type="button" disabled={!gameTitle.trim() || capture.uploading} onClick={start}>
            キャプチャ開始
          </button>
          {capture.uploading && (
            <div className="capture-companion-note">前のセッションの録画をアップロードしています…</div>
          )}
        </div>
      )}

      <h3>過去のセッション</h3>
      {records.length === 0 && <div className="empty-state">まだキャプチャセッションはありません。</div>}
      {records.map((record) => (
        <div key={record.id} className="capture-record-card">
          <div className="capture-record-head">
            <strong>{record.gameTitle}</strong>
            {' '}
            <span className="capture-record-meta">{recordSummary(record)}</span>
            <button type="button" onClick={() => toggleTimeline(record.id)}>
              {timelines[record.id] ? 'リプレイを閉じる' : 'リプレイ / タイムライン'}
            </button>
            {record.status === 'completed' && record.capture.audioFileName && (
              <button
                type="button"
                disabled={busyRecordId === record.id}
                onClick={() => analyze(record.id)}
              >
                {busyRecordId === record.id
                  ? '処理中…'
                  : record.analysis ? '音声を再分析' : '音声を感情分析'}
              </button>
            )}
            {record.status !== 'recording' && (
              <GazeAnalysisControl
                record={record}
                onDone={(message) => afterMediaChange(record.id, message)}
                onError={setError}
              />
            )}
            {record.status === 'completed' && (record.analysis || record.markers.length > 0) && (
              <button
                type="button"
                disabled={busyRecordId === record.id}
                onClick={() => createEmotionCurve(record.id)}
              >
                感情曲線を作成
              </button>
            )}
          </div>
          {record.analysis && !timelines[record.id] && (
            <div className="capture-analysis">
              <div className="capture-record-meta">
                文字起こし {record.analysis.utteranceCount} 発話
                ({new Date(record.analysis.analyzedAt).toLocaleString()},
                {' '}{record.analysis.extractor})
                {record.gazeEstimation
                  ? ` ・ 視線推定 ${record.gazeEstimation.extractor} (${record.gazeEstimation.calibrated ? 'キャリブレーション適用' : '粗い推定'})`
                  : ''}
              </div>
            </div>
          )}
          {timelines[record.id] && (
            <CaptureReplayView record={record} timeline={timelines[record.id]} />
          )}
          {record.status !== 'recording' && timelines[record.id] && (
            <CaptureRecordingUpload
              record={record}
              onUploaded={(message) => afterMediaChange(record.id, message)}
              onError={setError}
            />
          )}
        </div>
      ))}
    </div>
  );
}
