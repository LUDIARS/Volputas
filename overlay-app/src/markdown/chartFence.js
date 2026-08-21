// ```chart フェンスの解析 (spec/feature/window-overlay-extension.md §グラフ)。
// 描画から独立した純粋関数だけを置く: JSX 変換なしで node --test から読める。
import { CHART_TYPES } from '../lib/chartTypes.js';
import { isAllowedOverlayApiPath } from '../lib/overlayApiPath.js';

const SOURCE_KINDS = Object.freeze(['inline', 'api', 'file']);

// 各チャートが必要とするデータ形。ここでスキーマ不一致を落とすので、
// パネル側は「エラーカードを出すか、コンポーネントに渡すか」だけを見る。
const CHART_SHAPES = Object.freeze({
  hotspot: { key: 'analysis', prop: 'analysis' },
  'narrative-arc': { key: 'analysis', prop: 'analysis' },
  trend: { key: 'series', prop: 'series' },
  series: { key: 'series', prop: 'series' },
  radar: { key: 'points', prop: 'points' },
});

function failure(code, message) {
  return { ok: false, error: { code, message } };
}

// react-markdown が渡す className からフェンス言語を取り出す。
// 描画側 (renderChartFence.jsx) の分岐条件をテスト可能にするためここに置く。
/** @implements SPEC-WINDOW-OVERLAY-EXTENSION */
export function fenceLanguageOf(className) {
  const match = /language-([\w-]+)/.exec(String(className || ''));
  return match ? match[1] : null;
}

/** @implements SPEC-WINDOW-OVERLAY-EXTENSION */
export function parseChartFence(text) {
  let raw;
  try {
    raw = JSON.parse(String(text || ''));
  } catch (error) {
    return failure('CHART_FENCE_INVALID_JSON', `chart フェンスが JSON として読めません: ${error.message}`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return failure('CHART_FENCE_INVALID_JSON', 'chart フェンスはオブジェクトである必要があります');
  }
  const type = String(raw.type || '');
  if (!CHART_TYPES.includes(type)) {
    return failure('CHART_FENCE_UNKNOWN_TYPE', `未対応のチャート種別: ${type || '(未指定)'}`);
  }
  const source = normalizeSource(raw.source);
  if (!source.ok) return source;
  return { ok: true, spec: { type, title: raw.title ? String(raw.title) : null, source: source.value } };
}

function normalizeSource(value) {
  if (value === undefined || value === null) {
    return { ok: true, value: { kind: 'inline', data: null } };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return failure('CHART_FENCE_INVALID_SOURCE', 'source はオブジェクトである必要があります');
  }
  const kind = String(value.kind || 'inline');
  if (!SOURCE_KINDS.includes(kind)) {
    return failure('CHART_FENCE_INVALID_SOURCE', `未対応の source.kind: ${kind}`);
  }
  if (kind === 'inline') {
    if (value.data === undefined) {
      return failure('CHART_FENCE_INVALID_SOURCE', 'inline source には data が要ります');
    }
    return { ok: true, value: { kind, data: value.data } };
  }
  const path = String(value.path || '');
  if (!path) {
    return failure('CHART_FENCE_INVALID_SOURCE', `${kind} source には path が要ります`);
  }
  if (kind === 'api' && !isAllowedOverlayApiPath(path)) {
    return failure(
      'CHART_FENCE_INVALID_SOURCE',
      'api source.path は /api/local/overlay/ 配下である必要があります'
    );
  }
  return { ok: true, value: { kind, path } };
}

// データをチャートコンポーネントの props へ写す。ここで形が合わなければ
// エラーカードにする — パネル全体を壊さないための境界。
/** @implements SPEC-WINDOW-OVERLAY-EXTENSION */
export function chartPropsFor(type, data) {
  const shape = CHART_SHAPES[type];
  if (!shape) return failure('CHART_FENCE_UNKNOWN_TYPE', `未対応のチャート種別: ${type}`);
  const payload = data && typeof data === 'object' && !Array.isArray(data) && shape.key in data
    ? data[shape.key]
    : data;
  if (shape.prop === 'analysis') {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return failure('CHART_DATA_SCHEMA_MISMATCH', `${type} には analysis オブジェクトが要ります`);
    }
    return { ok: true, props: { analysis: payload } };
  }
  if (!Array.isArray(payload)) {
    return failure('CHART_DATA_SCHEMA_MISMATCH', `${type} には ${shape.key} 配列が要ります`);
  }
  if (shape.prop === 'points') {
    const dimensions = Array.isArray(data?.dimensions) ? data.dimensions : [];
    const vector = Array.isArray(data?.vector) ? data.vector : [];
    return { ok: true, props: { points: payload, dimensions, vector } };
  }
  return { ok: true, props: { series: payload } };
}

export { SOURCE_KINDS, CHART_SHAPES };
