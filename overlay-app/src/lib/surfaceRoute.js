// サーフェスのウインドウかどうかの判定 (spec 追補 §呼び出し)。
// Rust 側は index.html?surface=<id> で同じフロントを開くので、エントリは
// この純粋関数 1 つで「パネルの本体」と「サーフェス」を分ける。

const SURFACE_ID_PATTERN = /^surface-\d+$/;

/** @implements SPEC-WINDOW-OVERLAY-EXTENSION */
export function surfaceIdFromSearch(search) {
  const params = new URLSearchParams(String(search || ''));
  const id = params.get('surface');
  if (!id || !SURFACE_ID_PATTERN.test(id)) return null;
  return id;
}
