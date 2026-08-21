// プロファイル切替と対象ウインドウの選択 (spec §設定 / task T8, ピックモード T3)。
// グラブハンドルでもある: ここに乗っている間だけクリック透過が解除される。
import { useEffect, useState } from 'react';
import {
  OVERLAY_EVENTS,
  beginPickMode,
  listProfiles,
  listWindows,
  loadProfile,
  onOverlayEvent,
  saveProfile,
  setInteractive,
  setTarget,
  startDragging,
} from '../lib/overlayBridge.js';
import { validateOverlayProfile } from '../lib/profileSchema.js';
import { persistWindowTarget } from '../lib/profileTarget.js';

/** @implements SPEC-WINDOW-OVERLAY-EXTENSION */
export default function ProfileBar({ profile, onProfile, tracker }) {
  const [profiles, setProfiles] = useState([]);
  const [windows, setWindows] = useState([]);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    listProfiles().then(setProfiles).catch(() => setProfiles([]));
  }, [profile?.name]);

  useEffect(() => onOverlayEvent(OVERLAY_EVENTS.windowPicked, (picked) => {
    setPicking(false);
    setError(null);
    persistWindowTarget(profile, picked, saveProfile)
      .then(onProfile)
      .catch((cause) => {
        // Rust は pick 完了時点で対象を切り替えている。保存に失敗したら
        // profile の対象へ戻し、実行状態と永続状態を食い違わせない。
        setTarget(profile.target).catch(() => {});
        setError(String(cause?.message || cause));
      });
  }), [profile, onProfile]);

  async function switchProfile(name) {
    if (!name) return;
    setError(null);
    try {
      const loaded = validateOverlayProfile(await loadProfile(name));
      onProfile(loaded);
    } catch (cause) {
      setError(String(cause?.message || cause));
    }
  }

  async function openWindowList() {
    try {
      setWindows(await listWindows());
      setError(null);
    } catch (cause) {
      setWindows([]);
      setError(String(cause?.message || cause));
    }
  }

  async function chooseWindow(windowInfo) {
    setError(null);
    try {
      onProfile(await persistWindowTarget(profile, windowInfo, saveProfile));
    } catch (cause) {
      setError(String(cause?.message || cause));
    }
  }

  return (
    <header
      className="overlay-grab"
      onMouseEnter={() => setInteractive('hover', true).catch(() => {})}
      onMouseLeave={() => setInteractive('hover', false).catch(() => {})}
    >
      <select
        value={profile?.name || ''}
        onChange={(event) => { void switchProfile(event.target.value); }}
      >
        {profiles.length === 0 ? <option value="">(プロファイル無し)</option> : null}
        {profiles.map((name) => <option key={name} value={name}>{name}</option>)}
      </select>
      <span className={tracker?.bound ? 'overlay-live' : 'overlay-offline'}>
        {!tracker?.followsAutomatically
          ? '手動配置モード'
          : (tracker?.bound ? (tracker.title || '追従中') : '対象ウインドウ未接続')}
      </span>
      <button
        type="button"
        title="オーバーレイを移動"
        onMouseDown={(event) => {
          if (event.button === 0) startDragging().catch((cause) => setError(String(cause?.message || cause)));
        }}
      >
        移動
      </button>
      <button
        type="button"
        onClick={() => { setPicking(true); beginPickMode().catch(() => setPicking(false)); }}
      >
        {picking ? 'クリックで選択…' : 'ウインドウを選ぶ'}
      </button>
      <select
        onFocus={() => { void openWindowList(); }}
        onChange={(event) => {
          const chosen = windows.find((window) => String(window.id) === event.target.value);
          event.target.value = '';
          if (chosen) void chooseWindow(chosen);
        }}
        defaultValue=""
      >
        <option value="">一覧から…</option>
        {windows.map((window) => (
          <option key={window.id} value={window.id}>
            {window.processName} — {window.title}
          </option>
        ))}
      </select>
      {error ? <span className="overlay-offline" role="alert">{error}</span> : null}
    </header>
  );
}
