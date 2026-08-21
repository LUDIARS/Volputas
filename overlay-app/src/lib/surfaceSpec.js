// 情報サーフェスの配置指定の正規化 (spec 追補 §呼び出し / §配置計算)。
// Rust 側 (overlay/surface.rs) が受け取る形へ寄せる純粋関数だけを置く:
// 矩形計算そのものは Rust の resolve_surface_rect が正本で、ここでは
// 「呼び出し側の書き忘れ・書き間違いを既定値と例外に落とす」ことだけを行う。

/** align の 9 通り。Rust の SurfaceAlign と同じ綴り。 */
export const SURFACE_ALIGNS = Object.freeze([
  'top-left',
  'top-center',
  'top-right',
  'middle-left',
  'middle-center',
  'middle-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
]);

export const DEFAULT_SURFACE_SIZE = Object.freeze({ width: 360, height: 200 });

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

function finiteNumber(value, fallback, { code, label }) {
  if (value === undefined || value === null) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) fail(code, `${label} は数値である必要があります`);
  return number;
}

function integer(value, fallback, options) {
  return Math.round(finiteNumber(value, fallback, options));
}

// ビュー領域内の相対座標。0..1 の外は「対象の外を指したい」意図と紛らわしいので
// 弾く: 枠外へ出したいときは offset を使う (spec 追補 §呼び出し)。
function normalizeAt(at) {
  const viewX = finiteNumber(at?.viewX, 0.5, { code: 'SURFACE_INVALID_AT', label: 'at.viewX' });
  const viewY = finiteNumber(at?.viewY, 0.5, { code: 'SURFACE_INVALID_AT', label: 'at.viewY' });
  if (viewX < 0 || viewX > 1 || viewY < 0 || viewY > 1) {
    fail('SURFACE_INVALID_AT', 'at はビュー領域内の相対座標 (0..1) です。枠外へ出すには offset を使ってください');
  }
  return { viewX, viewY };
}

function normalizeSize(size) {
  const width = integer(size?.width, DEFAULT_SURFACE_SIZE.width, {
    code: 'SURFACE_INVALID_SIZE',
    label: 'size.width',
  });
  const height = integer(size?.height, DEFAULT_SURFACE_SIZE.height, {
    code: 'SURFACE_INVALID_SIZE',
    label: 'size.height',
  });
  if (width <= 0 || height <= 0) {
    fail('SURFACE_INVALID_SIZE', 'size.width / size.height は 1 以上である必要があります');
  }
  return { width, height };
}

/** @implements SPEC-WINDOW-OVERLAY-EXTENSION */
export function normalizeSurfaceSpec(spec = {}) {
  const align = spec.align === undefined ? 'middle-center' : String(spec.align);
  if (!SURFACE_ALIGNS.includes(align)) {
    fail('SURFACE_INVALID_ALIGN', `未対応の align: ${align}`);
  }
  return {
    at: normalizeAt(spec.at),
    offset: {
      x: integer(spec.offset?.x, 0, { code: 'SURFACE_INVALID_OFFSET', label: 'offset.x' }),
      y: integer(spec.offset?.y, 0, { code: 'SURFACE_INVALID_OFFSET', label: 'offset.y' }),
    },
    size: normalizeSize(spec.size),
    align,
  };
}
