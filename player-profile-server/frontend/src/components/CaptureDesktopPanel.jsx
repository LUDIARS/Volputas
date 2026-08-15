import { useEffect, useRef, useState } from 'react';
import { localApi } from '../lib/localApi';
import GazeCalibrationOverlay from './GazeCalibrationOverlay';

// Desktop capture controls for the active session
// (spec/feature/emotion-capture-companion.md §デスクトップキャプチャ): face camera
// + microphone, game-screen recording and gaze calibration. The recorders
// themselves live in useDesktopCapture; this component is the buttons, the
// camera preview and the status line.
const BASE = '/api/local/capture-sessions';

const STATUS_LABEL = {
  idle: '未開始',
  starting: '準備中…',
  recording: '録画中',
  stopped: '停止 (アップロード待ち)',
  uploading: 'アップロード中…',
  uploaded: 'アップロード済み',
  error: 'エラー',
};

/** @implements SPEC-EMOTION-CAPTURE-COMPANION */
export default function CaptureDesktopPanel({ active, capture, onNotice, onError }) {
  const previewRef = useRef(null);
  const [calibrating, setCalibrating] = useState(false);
  const [calibrationSaved, setCalibrationSaved] = useState(Boolean(active?.calibration));

  useEffect(() => {
    if (previewRef.current) previewRef.current.srcObject = capture.faceStream;
  }, [capture.faceStream]);

  useEffect(() => {
    setCalibrationSaved(Boolean(active?.calibration));
  }, [active?.id, active?.calibration]);

  async function saveCalibration({ points, screen }) {
    setCalibrating(false);
    try {
      await localApi(`${BASE}/${active.id}/calibration`, { method: 'PUT', body: { points, screen } });
      setCalibrationSaved(true);
      onNotice(`視線キャリブレーションを保存しました (${points.length} 点)。`);
    } catch (reason) {
      onError(reason.message);
    }
  }

  const supportsCapture = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices);
  const supportsScreen = supportsCapture && typeof navigator.mediaDevices.getDisplayMedia === 'function';

  return (
    <div className="capture-desktop-panel">
      <h4>この PC で録画</h4>
      {!supportsCapture && (
        <p className="capture-record-meta">このブラウザではカメラ・画面の取得ができません。</p>
      )}
      <div className="capture-desktop-grid">
        <div className="capture-desktop-track">
          <div className="capture-desktop-head">
            <strong>顔カメラ + マイク</strong>
            <span className="capture-record-meta">{STATUS_LABEL[capture.face.status]}</span>
          </div>
          <p className="capture-record-meta">
            事後の視線推定と文字起こし (感情分析) に使います。録画中にキャリブレーションを行うと視線推定の精度が上がります。
          </p>
          <video ref={previewRef} className="capture-face-preview" autoPlay muted playsInline />
          <div className="capture-active-actions">
            <button
              type="button"
              disabled={!supportsCapture || !['idle', 'error'].includes(capture.face.status) || capture.uploading}
              onClick={capture.startFace}
            >
              録画開始
            </button>
            <button
              type="button"
              disabled={capture.face.status !== 'recording'}
              onClick={() => setCalibrating(true)}
            >
              {calibrationSaved ? '視線キャリブレーションをやり直す' : '視線キャリブレーション'}
            </button>
          </div>
          {capture.face.error && <div className="error-message">{capture.face.error}</div>}
        </div>
        <div className="capture-desktop-track">
          <div className="capture-desktop-head">
            <strong>ゲーム画面 (音声込み)</strong>
            <span className="capture-record-meta">{STATUS_LABEL[capture.screen.status]}</span>
          </div>
          <p className="capture-record-meta">
            共有する画面/ウィンドウを選ぶと録画が始まります。セッション終了時に自動でアップロードされ、
            タイムラインで視線・発話と同期再生できます。OBS 等の録画は終了後にファイルで追加できます。
          </p>
          <div className="capture-active-actions">
            <button
              type="button"
              disabled={!supportsScreen || !['idle', 'error'].includes(capture.screen.status) || capture.uploading}
              onClick={capture.startScreen}
            >
              画面録画開始
            </button>
          </div>
          {capture.screen.error && <div className="error-message">{capture.screen.error}</div>}
        </div>
      </div>
      {capture.uploading && (
        <div className="capture-companion-note">録画をアップロードしています。このページを閉じないでください。</div>
      )}
      {calibrating && (
        <GazeCalibrationOverlay
          sessionClock={capture.sessionClock}
          onComplete={saveCalibration}
          onCancel={() => setCalibrating(false)}
        />
      )}
    </div>
  );
}
