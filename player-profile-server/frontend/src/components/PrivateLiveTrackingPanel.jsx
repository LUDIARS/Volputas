/** @implements SPEC-PRIVATE-LIVE-TRACKING */
export default function PrivateLiveTrackingPanel({ tracking }) {
  const { status, sample, error, retry } = tracking;
  return <section className="capture-desktop-panel" aria-label="目と顔の追跡">
    <h4>目と顔の追跡</h4>
    <p>スマホは内側のカメラ、PCは接続したカメラを使います。映像はこの端末内の追跡だけに使い、表示・録画・送信しません。</p>
    <p role="status">{status === 'starting' ? 'カメラと追跡を準備しています…'
      : status === 'tracking' ? (sample.faceDetected ? '顔を追跡中' : '顔が見つかりません')
        : status === 'error' ? '追跡は停止しています' : '追跡は未開始です'}</p>
    {sample?.eyes && <p>目の動きを追跡中（画面上の注視位置は未補正です）</p>}
    {sample?.pose && <p>顔の向き：左右 {sample.pose.yaw.toFixed(2)} / 上下 {sample.pose.pitch.toFixed(2)}</p>}
    {sample?.expressions && Object.keys(sample.expressions).length > 0 && <p>表情の動きを追跡中</p>}
    {error && <p role="alert">{error}</p>}
    {status === 'error' && <button type="button" onClick={retry}>追跡を再開</button>}
  </section>;
}
