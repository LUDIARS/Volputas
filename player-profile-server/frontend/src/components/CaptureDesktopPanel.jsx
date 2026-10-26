// Optional audio and game-screen recording, separate from private tracking.
const STATUS_LABEL = {
  idle: '未開始', starting: '準備中…', recording: '記録中',
  stopped: '停止', uploading: '送信中…', uploaded: '送信済み', error: 'エラー',
};

export default function CaptureDesktopPanel({ capture }) {
  const devices = typeof navigator !== 'undefined' ? navigator.mediaDevices : null;
  return <div className="capture-desktop-panel">
    <h4>音声・ゲーム画面の記録</h4>
    <p>必要な場合だけ開始してください。カメラ映像は含みません。</p>
    <div className="capture-desktop-grid">
      <div className="capture-desktop-track">
        <strong>マイク</strong> <span>{STATUS_LABEL[capture.microphone.status]}</span>
        <p>音声を記録し、終了後に文字起こし・感情分析用に送信します。</p>
        <button type="button" disabled={!devices?.getUserMedia || !['idle', 'error'].includes(capture.microphone.status) || capture.uploading}
          onClick={capture.startMicrophone}>音声の記録を開始</button>
        {capture.microphone.error && <p role="alert">{capture.microphone.error}</p>}
      </div>
      <div className="capture-desktop-track">
        <strong>ゲーム画面</strong> <span>{STATUS_LABEL[capture.screen.status]}</span>
        <p>選択したゲーム画面と音声を記録し、終了時に送信します。</p>
        <button type="button" disabled={!devices?.getDisplayMedia || !['idle', 'error'].includes(capture.screen.status) || capture.uploading}
          onClick={capture.startScreen}>画面の記録を開始</button>
        {capture.screen.error && <p role="alert">{capture.screen.error}</p>}
      </div>
    </div>
    {capture.uploading && <p>記録を送信しています。このページを閉じないでください。</p>}
  </div>;
}
