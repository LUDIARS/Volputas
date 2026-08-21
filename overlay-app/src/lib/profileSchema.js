// overlay-profiles/<name>.json のスキーマ (spec §設定 / task T8)。
// Rust 側 (profile.rs) はファイル入出力だけを持ち、意味づけはここに寄せる。
import { isChartType } from './chartTypes.js';
import { isAllowedOverlayApiPath } from './overlayApiPath.js';

export const PLACEMENT_MODES = Object.freeze(['overlay', 'dock', 'detached']);
export const ANCHORS = Object.freeze([
  'top-left', 'top-center', 'top-right',
  'middle-left', 'middle-center', 'middle-right',
  'bottom-left', 'bottom-center', 'bottom-right',
]);
export const DOCK_SIDES = Object.freeze(['left', 'right', 'top', 'bottom']);
export const PANEL_TYPES = Object.freeze(['markdown', 'chart', 'markers']);
export const MARKDOWN_SOURCE_KINDS = Object.freeze(['file', 'inline', 'api']);
const INVALID_PROFILE_NAME_PATTERN = /[<>:"\/\\|?*\u0000-\u001F]/;

export const DEFAULT_HOTKEYS = Object.freeze({
  hype: 'Ctrl+Alt+1',
  like: 'Ctrl+Alt+2',
  dislike: 'Ctrl+Alt+3',
  stress: 'Ctrl+Alt+4',
  comment: 'Ctrl+Alt+Enter',
});

function invalid(message) {
  return Object.assign(new Error(message), { code: 'INVALID_OVERLAY_PROFILE' });
}

function text(value, field, { required = false, maximum = 200 } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw invalid(field + ' は必須です');
    return null;
  }
  const normalized = String(value).trim();
  if (!normalized) {
    if (required) throw invalid(field + ' は必須です');
    return null;
  }
  if (normalized.length > maximum) throw invalid(field + ' が長すぎます');
  return normalized;
}

function number(value, field, { minimum, maximum, fallback }) {
  if (value === undefined || value === null) return fallback;
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < minimum || normalized > maximum) {
    throw invalid(field + ' は ' + minimum + '..' + maximum + ' の数値である必要があります');
  }
  return normalized;
}

function boolean(value, fallback) {
  return value === undefined || value === null ? fallback : value === true;
}

function profileName(value) {
  const name = text(value, 'name', { required: true, maximum: 64 });
  if (name.startsWith('.') || name.endsWith('.') || name.endsWith(' ')
      || INVALID_PROFILE_NAME_PATTERN.test(name)) {
    throw invalid('name にファイル名として使えない文字があります');
  }
  return name;
}

function normalizeTarget(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid('target はオブジェクトである必要があります');
  }
  const processName = text(value.processName, 'target.processName');
  const titlePattern = text(value.titlePattern, 'target.titlePattern', { maximum: 400 });
  if (titlePattern) {
    try {
      new RegExp(titlePattern);
    } catch (error) {
      throw invalid('target.titlePattern が正規表現として不正です: ' + error.message);
    }
  }
  return { processName, titlePattern };
}

function normalizePlacement(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const mode = String(source.mode || 'overlay');
  if (!PLACEMENT_MODES.includes(mode)) throw invalid('未対応の placement.mode: ' + mode);
  const placement = {
    mode,
    width: number(source.width, 'placement.width', { minimum: 80, maximum: 8000, fallback: 420 }),
    height: number(source.height, 'placement.height', { minimum: 60, maximum: 8000, fallback: 320 }),
    margin: number(source.margin, 'placement.margin', { minimum: 0, maximum: 400, fallback: 12 }),
    opacity: number(source.opacity, 'placement.opacity', { minimum: 0.1, maximum: 1, fallback: 0.92 }),
    anchor: null,
    side: null,
    x: null,
    y: null,
  };
  if (mode === 'overlay') {
    const anchor = String(source.anchor || 'top-right');
    if (!ANCHORS.includes(anchor)) throw invalid('未対応の placement.anchor: ' + anchor);
    placement.anchor = anchor;
  }
  if (mode === 'dock') {
    const side = String(source.side || 'right');
    if (!DOCK_SIDES.includes(side)) throw invalid('未対応の placement.side: ' + side);
    placement.side = side;
  }
  if (mode === 'detached') {
    placement.x = number(source.x, 'placement.x', { minimum: -32000, maximum: 32000, fallback: 100 });
    placement.y = number(source.y, 'placement.y', { minimum: -32000, maximum: 32000, fallback: 100 });
  }
  return placement;
}

function normalizeMarkdownSource(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid('markdown パネルには source が要ります');
  }
  const kind = String(value.kind || '');
  if (!MARKDOWN_SOURCE_KINDS.includes(kind)) {
    throw invalid('未対応の markdown source.kind: ' + (kind || '(未指定)'));
  }
  if (kind === 'inline') {
    return { kind, markdown: String(value.markdown || '') };
  }
  const path = text(value.path, 'markdown source.path', { required: true, maximum: 1000 });
  if (kind === 'api' && !isAllowedOverlayApiPath(path)) {
    throw invalid('api source.path は /api/local/overlay/ 配下である必要があります');
  }
  return { kind, path };
}

function normalizePanel(value, index) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid('panels[' + index + '] はオブジェクトである必要があります');
  }
  const type = String(value.type || '');
  if (!PANEL_TYPES.includes(type)) {
    throw invalid('未対応の panels[' + index + '].type: ' + (type || '(未指定)'));
  }
  const panel = { type, id: text(value.id, 'panels[' + index + '].id') || type + '-' + index };
  if (type === 'markdown') {
    return { ...panel, source: normalizeMarkdownSource(value.source) };
  }
  if (type === 'chart') {
    const chart = value.chart;
    if (!chart || typeof chart !== 'object' || Array.isArray(chart)) {
      throw invalid('panels[' + index + '].chart はオブジェクトである必要があります');
    }
    if (!isChartType(chart.type)) {
      throw invalid('未対応の panels[' + index + '].chart.type: ' + (chart.type || '(未指定)'));
    }
    return {
      ...panel,
      chart: {
        type: String(chart.type),
        title: text(chart.title, 'chart.title'),
        source: chart.source ?? null,
      },
    };
  }
  const hotkeys = { ...DEFAULT_HOTKEYS };
  if (value.hotkeys && typeof value.hotkeys === 'object' && !Array.isArray(value.hotkeys)) {
    for (const [action, binding] of Object.entries(value.hotkeys)) {
      if (!(action in DEFAULT_HOTKEYS)) throw invalid('未対応のホットキー: ' + action);
      hotkeys[action] = text(binding, 'hotkeys.' + action, { required: true, maximum: 64 });
    }
  }
  return { ...panel, hotkeys };
}

/** @implements SPEC-WINDOW-OVERLAY-EXTENSION */
export function validateOverlayProfile(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid('プロファイルはオブジェクトである必要があります');
  }
  const schemaVersion = number(value.schemaVersion, 'schemaVersion', {
    minimum: 1, maximum: 1, fallback: 1,
  });
  const panels = Array.isArray(value.panels) ? value.panels : [];
  return {
    schemaVersion,
    name: profileName(value.name),
    target: normalizeTarget(value.target),
    placement: normalizePlacement(value.placement),
    followZOrder: boolean(value.followZOrder, true),
    clickThrough: boolean(value.clickThrough, true),
    panels: panels.map(normalizePanel),
  };
}

/** @implements SPEC-WINDOW-OVERLAY-EXTENSION */
export function defaultOverlayProfile(name = 'default') {
  return validateOverlayProfile({
    schemaVersion: 1,
    name,
    target: { processName: null, titlePattern: null },
    placement: { mode: 'dock', side: 'right', width: 420, opacity: 0.92 },
    panels: [{ type: 'markers' }],
  });
}
