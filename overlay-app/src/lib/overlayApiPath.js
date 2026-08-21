// Rust の ApiClient と同じ local GET 境界を WebView 側でも先に検証する。
// 最終的な認可は Rust 側が持つが、profile / chart の誤設定は描画前に示す。
const OVERLAY_API_PREFIX = '/api/local/overlay/';
const SAFE_PATH_PATTERN = /^[A-Za-z0-9/._-]+$/;

/** @implements SPEC-WINDOW-OVERLAY-EXTENSION */
export function isAllowedOverlayApiPath(value) {
  const path = String(value || '');
  return path.startsWith(OVERLAY_API_PREFIX)
    && SAFE_PATH_PATTERN.test(path)
    && !path.split('/').some((segment) => segment === '.' || segment === '..');
}
