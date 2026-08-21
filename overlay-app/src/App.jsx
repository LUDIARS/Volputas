// オーバーレイ本体 (spec §表示コンテンツ)。
// プロファイルの panels をそのまま縦に並べ、追従状態と操作可能状態を枠で示す。
import { useEffect, useState } from 'react';
import ProfileBar from './panels/ProfileBar.jsx';
import MarkdownPanel from './panels/MarkdownPanel.jsx';
import ChartPanel from './panels/ChartPanel.jsx';
import MarkerPanel from './panels/MarkerPanel.jsx';
import ErrorCard from './markdown/ErrorCard.jsx';
import { defaultOverlayProfile, validateOverlayProfile } from './lib/profileSchema.js';
import {
  OVERLAY_EVENTS,
  applyPlacement,
  isTauriRuntime,
  loadProfile,
  onOverlayEvent,
  setClickThrough,
  trackerState,
} from './lib/overlayBridge.js';

function Panel({ panel }) {
  if (panel.type === 'markdown') return <MarkdownPanel source={panel.source} />;
  if (panel.type === 'chart') return <ChartPanel chart={panel.chart} />;
  return <MarkerPanel hotkeys={panel.hotkeys} />;
}

/** @implements SPEC-WINDOW-OVERLAY-EXTENSION */
export default function App() {
  const [profile, setProfile] = useState(() => defaultOverlayProfile());
  const [tracker, setTracker] = useState({
    bound: false,
    visible: true,
    title: null,
    followsAutomatically: true,
  });
  const [interactive, setInteractiveState] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    loadProfile(null)
      .then((loaded) => setProfile(validateOverlayProfile(loaded)))
      .catch((cause) => setError({ code: cause.code || 'PROFILE_LOAD_FAILED', message: String(cause.message || cause) }));
    trackerState().then((next) => {
      setTracker(next);
      // Native startup may have emitted the interactive event before React
      // subscribed. Mirror the unbound configuration state for its border.
      setInteractiveState(!next.bound);
    }).catch(() => {});
  }, []);

  // プロファイルが変わったら配置とクリック透過を Rust 側へ反映する。
  useEffect(() => {
    if (!isTauriRuntime()) return;
    applyPlacement(profile.placement).catch(() => {});
    setClickThrough(profile.clickThrough).catch(() => {});
  }, [profile]);

  useEffect(() => onOverlayEvent(OVERLAY_EVENTS.targetChanged, (payload) => {
    setTracker((previous) => ({
      ...previous,
      bound: true,
      visible: payload?.visible !== false,
      title: payload?.title || null,
    }));
  }), []);

  useEffect(() => onOverlayEvent(OVERLAY_EVENTS.targetLost, () => {
    setTracker((previous) => ({ ...previous, bound: false, visible: true, title: null }));
  }), []);

  useEffect(() => onOverlayEvent(OVERLAY_EVENTS.interactiveChanged, (payload) => {
    setInteractiveState(Boolean(payload?.interactive));
  }), []);

  const classNames = [
    'overlay-root',
    interactive ? 'overlay-interactive' : 'overlay-passthrough',
    tracker.bound ? '' : 'overlay-unbound',
  ].filter(Boolean).join(' ');

  return (
    <div className={classNames} style={{ opacity: profile.placement.opacity }}>
      <ProfileBar profile={profile} onProfile={setProfile} tracker={tracker} />
      {error ? <ErrorCard error={error} /> : null}
      {!tracker.bound ? (
        <p className="overlay-notice">
          {tracker.followsAutomatically
            ? '対象ウインドウを選択するか、再バインドを待ってください'
            : '自動追従できない環境です。「移動」で手動配置してください'}
        </p>
      ) : null}
      <main className="overlay-panels">
        {profile.panels.map((panel) => (
          <section key={panel.id} className="overlay-panel-slot">
            <Panel panel={panel} />
          </section>
        ))}
      </main>
    </div>
  );
}
