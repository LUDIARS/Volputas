// 情報サーフェスに載せる内容の正規化 (spec 追補 §呼び出し)。
// 受けるのは既存パネルが描ける 2 種だけ: { kind: 'markdown', source } と
// { kind: 'chart', chart }。描画は MarkdownPanel / ChartPanel と
// renderChartFence をそのまま使うので、ここには描画も取得も持たせない。

export const SURFACE_CONTENT_KINDS = Object.freeze(['markdown', 'chart']);

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

/** @implements SPEC-WINDOW-OVERLAY-EXTENSION */
export function normalizeSurfaceContent(content) {
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    fail('SURFACE_INVALID_CONTENT', 'content はオブジェクトである必要があります');
  }
  const kind = String(content.kind || '');
  if (!SURFACE_CONTENT_KINDS.includes(kind)) {
    fail('SURFACE_INVALID_CONTENT', `未対応の content.kind: ${kind || '(未指定)'}`);
  }
  if (kind === 'markdown') {
    if (!content.source || typeof content.source !== 'object') {
      fail('SURFACE_INVALID_CONTENT', 'markdown の content には source が要ります');
    }
    return { kind, source: content.source };
  }
  if (!content.chart || typeof content.chart !== 'object') {
    fail('SURFACE_INVALID_CONTENT', 'chart の content には chart が要ります');
  }
  return { kind, chart: content.chart };
}
