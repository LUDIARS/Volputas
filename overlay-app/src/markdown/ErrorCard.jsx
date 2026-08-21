// フェンス 1 個分のエラー表示 (spec §グラフ)。
// パネル全体を落とさず、ブロックの位置にそのまま出す。
/** @implements SPEC-WINDOW-OVERLAY-EXTENSION */
export default function ErrorCard({ error }) {
  return (
    <div className="overlay-error-card" role="note">
      <strong>{error?.code || 'ERROR'}</strong>
      <span>{error?.message || '描画できませんでした'}</span>
    </div>
  );
}
