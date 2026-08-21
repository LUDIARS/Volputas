// Tauri command / event のラッパ (spec §配置 lib/overlayBridge.js)。
// WebView は Rust 側だけを窓口にする: local API への HTTP も、ファイル読みも、
// ホットキーもここを通る。ブラウザで開いたとき (npm run dev) は
// TAURI ランタイムが無いので、無効化された状態を返して UI を壊さない。
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen as tauriListen } from '@tauri-apps/api/event';

export const OVERLAY_EVENTS = Object.freeze({
  targetChanged: 'overlay://target-changed',
  targetLost: 'overlay://target-lost',
  markdownChanged: 'overlay://markdown-changed',
  markerHotkey: 'overlay://marker-hotkey',
  commentHotkey: 'overlay://comment-hotkey',
  interactiveChanged: 'overlay://interactive-changed',
  windowPicked: 'overlay://window-picked',
  surfaceUpdated: 'overlay://surface-updated',
});

/** @implements SPEC-WINDOW-OVERLAY-EXTENSION */
export function isTauriRuntime() {
  return typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);
}

async function call(command, args) {
  if (!isTauriRuntime()) {
    throw Object.assign(new Error('Tauri ランタイムの外では ' + command + ' は使えません'), {
      code: 'OVERLAY_RUNTIME_UNAVAILABLE',
    });
  }
  return tauriInvoke(command, args);
}

/** @implements SPEC-WINDOW-OVERLAY-EXTENSION */
export function onOverlayEvent(event, handler) {
  if (!isTauriRuntime()) return () => {};
  const unlisten = tauriListen(event, (payload) => handler(payload.payload));
  return () => { unlisten.then((stop) => stop()).catch(() => {}); };
}

// ---- ウインドウ追従 (T3) ----
export const listWindows = () => call('overlay_list_windows');
export const beginPickMode = () => call('overlay_begin_pick');
export const setTarget = (target) => call('overlay_set_target', { target });
export const trackerState = () => call('overlay_tracker_state');
export const applyPlacement = (placement) => call('overlay_apply_placement', { placement });

// ---- クリック透過 (T4) ----
export const setClickThrough = (enabled) => call('overlay_set_click_through', { enabled });
// claim は操作可能状態を要求している主体 ('hover' / 'comment')。解除は自分の
// 要求だけを取り下げるので、hover 中にコメントを閉じてもヘッダは操作可能なまま。
export const setInteractive = (claim, interactive) =>
  call('overlay_set_interactive', { claim, interactive });
export const startDragging = () => call('overlay_start_dragging');

// ---- 情報サーフェス (spec 追補) ----
// 出す・差し替える・消すの 3 つだけ。クリック透過の切り替えは渡さない:
// サーフェスは見せるだけの面で、操作を受ける面はパネル (spec 追補 §不変条件 1)。
export const surfaceAttach = (request) => call('overlay_surface_attach', { request });
export const surfaceUpdate = ({ id, spec, content }) =>
  call('overlay_surface_update', { id, spec, content });
export const surfaceClose = ({ id }) => call('overlay_surface_close', { id });
export const surfaceDescriptor = (id) => call('overlay_surface_descriptor', { id });

// ---- 表示コンテンツ (T5 / T6) ----
export const readMarkdown = (source) => call('overlay_read_markdown', { source });
export const watchMarkdown = (path) => call('overlay_watch_markdown', { path });
export const unwatchMarkdown = (path) => call('overlay_unwatch_markdown', { path });
export const readJson = (source) => call('overlay_read_json', { source });

// ---- 感想マーカー (T7) ----
export const localStatus = () => call('overlay_local_status');
export const postMarker = (marker) => call('overlay_post_marker', { marker });

// ---- プロファイル (T8) ----
export const listProfiles = () => call('overlay_list_profiles');
export const loadProfile = (name) => call('overlay_load_profile', { name });
export const saveProfile = (profile) => call('overlay_save_profile', { profile });
