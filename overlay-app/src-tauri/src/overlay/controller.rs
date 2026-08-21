//! 追従ループと Tauri ウインドウへの反映 (spec §追従ループ / §配置モード)。
//!
//! イベント駆動を第一とし、`POLL_INTERVAL` (100ms) はバックアップに留める。
//! ここが唯一 Tauri のウインドウ API を触る場所で、状態遷移そのものは
//! `tracker::TrackerSession` が持つ。
//! @implements SPEC-WINDOW-OVERLAY-EXTENSION
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize};

use super::interactive_claims::{InteractiveClaims, CLAIM_UNBOUND};
use super::placement::{Placement, Rect};
use super::surface_registry::SurfaceRegistry;
use super::tracker::{TrackerEvent, TrackerSession, TrackerSnapshot, WindowTracker, POLL_INTERVAL};
use super::window_target::{WindowInfo, WindowTarget};

pub const EVENT_TARGET_CHANGED: &str = "overlay://target-changed";
pub const EVENT_TARGET_LOST: &str = "overlay://target-lost";
pub const EVENT_WINDOW_PICKED: &str = "overlay://window-picked";
pub const EVENT_INTERACTIVE_CHANGED: &str = "overlay://interactive-changed";

const OVERLAY_WINDOW_LABEL: &str = "main";

#[derive(Debug, Clone, Serialize)]
struct TargetChangedPayload {
    id: u64,
    title: String,
    visible: bool,
    rect: Rect,
}

#[derive(Debug, Clone, Serialize)]
struct InteractivePayload {
    interactive: bool,
}

pub struct OverlayController {
    tracker: Arc<dyn WindowTracker>,
    session: Mutex<TrackerSession>,
    placement: Mutex<Placement>,
    follow_z_order: AtomicBool,
    click_through: AtomicBool,
    /// 操作可能状態を要求している主体の集合 (`interactive_claims` 参照)。
    interactive: Mutex<InteractiveClaims>,
    picking: AtomicBool,
    wake: Mutex<Option<Sender<()>>>,
    /// 情報サーフェス群。パネル (main ウインドウ) とは別扱いで、
    /// 追従基準はビュー領域、クリック透過は解除しない。
    surfaces: Arc<SurfaceRegistry>,
}

impl OverlayController {
    pub fn new(tracker: Box<dyn WindowTracker>) -> Self {
        Self {
            tracker: Arc::from(tracker),
            session: Mutex::new(TrackerSession::default()),
            placement: Mutex::new(Placement::default()),
            follow_z_order: AtomicBool::new(true),
            click_through: AtomicBool::new(true),
            interactive: Mutex::new(InteractiveClaims::default()),
            picking: AtomicBool::new(false),
            wake: Mutex::new(None),
            surfaces: Arc::new(SurfaceRegistry::new()),
        }
    }

    pub fn surfaces(&self) -> Arc<SurfaceRegistry> {
        Arc::clone(&self.surfaces)
    }

    pub fn list_windows(&self) -> Result<Vec<WindowInfo>, String> {
        self.tracker.list_windows().map_err(|error| error.to_string())
    }

    pub fn snapshot(&self) -> TrackerSnapshot {
        self.session
            .lock()
            .expect("tracker session is poisoned")
            .snapshot(self.tracker.as_ref())
    }

    pub fn set_target(&self, target: WindowTarget) {
        self.session
            .lock()
            .expect("tracker session is poisoned")
            .set_target(target);
        self.wake_loop();
    }

    pub fn set_placement(&self, placement: Placement) {
        *self.placement.lock().expect("placement is poisoned") = placement;
        self.wake_loop();
    }

    pub fn set_follow_z_order(&self, follow: bool) {
        self.follow_z_order.store(follow, Ordering::Relaxed);
        self.wake_loop();
    }

    /// ピックモード: 次にフォアグラウンドへ来たウインドウを対象にする。
    /// ユーザがクリックした先が前面になるので、これが「次にクリックした
    /// ウインドウ」の実装になる。
    pub fn begin_pick(&self) {
        self.picking.store(true, Ordering::Relaxed);
        self.wake_loop();
    }

    pub fn set_click_through(&self, app: &AppHandle, enabled: bool) -> Result<(), String> {
        self.click_through.store(enabled, Ordering::Relaxed);
        self.apply_cursor_events(app)
    }

    /// グラブハンドル hover / ホットキーからの一時解除。
    ///
    /// `claim` は要求元 (`"hover"` / `"comment"` など)。解除は自分の要求だけを
    /// 取り下げ、他の要求元がまだ操作可能状態を必要としていれば透過へ戻さない。
    pub fn set_interactive(
        &self,
        app: &AppHandle,
        claim: &str,
        interactive: bool,
    ) -> Result<(), String> {
        let active = self
            .interactive
            .lock()
            .map_err(|error| error.to_string())?
            .set(claim, interactive);
        let _ = app.emit(
            EVENT_INTERACTIVE_CHANGED,
            InteractivePayload {
                interactive: active,
            },
        );
        self.apply_cursor_events(app)
    }

    fn is_interactive(&self) -> bool {
        self.interactive
            .lock()
            .map(|claims| claims.is_active())
            .unwrap_or(false)
    }

    /// Keep the window usable while no target can be selected automatically.
    /// This covers first launch (empty target) and Wayland/manual fallback.
    pub fn refresh_unbound_window(&self, app: &AppHandle) -> Result<(), String> {
        let should_show = self
            .session
            .lock()
            .map_err(|error| error.to_string())?
            .should_show_configuration(self.tracker.as_ref());
        if !should_show {
            self.show(app, false);
            return Ok(());
        }

        if let Some(surface) = self.tracker.monitors().unwrap_or_default().first().copied() {
            self.apply_rect(app, surface);
        }
        self.show(app, true);
        self.set_interactive(app, CLAIM_UNBOUND, true)
    }

    fn apply_cursor_events(&self, app: &AppHandle) -> Result<(), String> {
        let Some(window) = app.get_webview_window(OVERLAY_WINDOW_LABEL) else {
            return Ok(());
        };
        // 既定はクリック透過 ON。操作可能状態のときだけ OFF にする。
        let ignore = self.click_through.load(Ordering::Relaxed) && !self.is_interactive();
        window
            .set_ignore_cursor_events(ignore)
            .map_err(|error| error.to_string())
    }

    fn wake_loop(&self) {
        if let Ok(wake) = self.wake.lock() {
            if let Some(sender) = wake.as_ref() {
                let _ = sender.send(());
            }
        }
    }

    /// 追従スレッドを立ち上げる。OS 側の変化通知と 100ms のバックアップを
    /// 同じチャンネルで待ち合わせる。
    pub fn spawn(self: &Arc<Self>, app: AppHandle) {
        let (sender, receiver): (Sender<()>, Receiver<()>) = channel();
        if let Ok(mut wake) = self.wake.lock() {
            *wake = Some(sender.clone());
        }
        #[cfg(target_os = "windows")]
        super::tracker_windows::spawn_change_notifier(sender.clone());

        let controller = Arc::clone(self);
        std::thread::spawn(move || loop {
            controller.tick(&app);
            // イベントが来れば即座に、来なくても 100ms で起きる。
            let _ = receiver.recv_timeout(POLL_INTERVAL);
        });
    }

    fn tick(&self, app: &AppHandle) {
        self.tick_pick(app);
        let events = {
            let mut session = self.session.lock().expect("tracker session is poisoned");
            match session.poll(self.tracker.as_ref()) {
                Ok(events) => events,
                Err(_) => return,
            }
        };
        for event in events {
            self.handle(app, event);
        }
        self.sync_surfaces(app);
    }

    /// 情報サーフェスの追従基準を更新する。パネルの配置 (外枠基準) とは
    /// 別に、対象のビュー領域とモニタ一覧をそのままレジストリへ渡す。
    fn sync_surfaces(&self, app: &AppHandle) {
        let view = self
            .session
            .lock()
            .ok()
            .and_then(|session| session.view_rect());
        let monitors = self.tracker.monitors().unwrap_or_default();
        self.surfaces.set_viewport(app, view, monitors);
    }

    fn tick_pick(&self, app: &AppHandle) {
        if !self.picking.load(Ordering::Relaxed) {
            return;
        }
        let Ok(Some(foreground)) = self.tracker.foreground_window() else {
            return;
        };
        let Ok(windows) = self.tracker.list_windows() else {
            return;
        };
        let Some(picked) = windows.into_iter().find(|window| window.id == foreground) else {
            return;
        };
        // 自分自身は選ばせない (オーバーレイをクリックしても対象にしない)。
        if picked.process_name.eq_ignore_ascii_case("volputas-overlay.exe") {
            return;
        }
        self.picking.store(false, Ordering::Relaxed);
        let target = WindowTarget {
            process_name: Some(picked.process_name.clone()),
            title_pattern: None,
        };
        self.session
            .lock()
            .expect("tracker session is poisoned")
            .set_target(target);
        let _ = app.emit(EVENT_WINDOW_PICKED, &picked);
    }

    fn handle(&self, app: &AppHandle, event: TrackerEvent) {
        match event {
            TrackerEvent::Bound { id, title, rect } => {
                self.apply_rect(app, rect);
                self.show(app, true);
                self.surfaces.set_visible(app, true);
                // 対象へ束縛できたので、未束縛のあいだの操作可能要求は取り下げる。
                let _ = self.set_interactive(app, CLAIM_UNBOUND, false);
                let _ = app.emit(
                    EVENT_TARGET_CHANGED,
                    TargetChangedPayload { id, title, visible: true, rect },
                );
            }
            TrackerEvent::Moved { rect } | TrackerEvent::Restored { rect } => {
                self.apply_rect(app, rect);
                self.show(app, true);
                self.surfaces.set_visible(app, true);
                let snapshot = self.snapshot();
                let _ = app.emit(
                    EVENT_TARGET_CHANGED,
                    TargetChangedPayload {
                        id: 0,
                        title: snapshot.title.unwrap_or_default(),
                        visible: true,
                        rect,
                    },
                );
            }
            TrackerEvent::Hidden => {
                self.show(app, false);
                self.surfaces.set_visible(app, false);
            }
            TrackerEvent::Lost => {
                self.show(app, false);
                self.surfaces.set_visible(app, false);
                let _ = app.emit(EVENT_TARGET_LOST, ());
            }
            TrackerEvent::ForegroundChanged { foreground } => {
                if !self.follow_z_order.load(Ordering::Relaxed) {
                    return;
                }
                // 対象が前面のときだけ最前面に出す (既定 followZOrder: true)。
                if let Some(window) = app.get_webview_window(OVERLAY_WINDOW_LABEL) {
                    let _ = window.set_always_on_top(foreground);
                }
            }
        }
    }

    fn apply_rect(&self, app: &AppHandle, target: Rect) {
        let Some(window) = app.get_webview_window(OVERLAY_WINDOW_LABEL) else {
            return;
        };
        let placement = *self.placement.lock().expect("placement is poisoned");
        let monitors = self.tracker.monitors().unwrap_or_default();
        let rect = super::placement::compute(&placement, &target, &monitors);
        let _ = window.set_position(PhysicalPosition::new(rect.x, rect.y));
        let _ = window.set_size(PhysicalSize::new(
            rect.width.max(1) as u32,
            rect.height.max(1) as u32,
        ));
    }

    fn show(&self, app: &AppHandle, visible: bool) {
        let Some(window) = app.get_webview_window(OVERLAY_WINDOW_LABEL) else {
            return;
        };
        let _ = if visible { window.show() } else { window.hide() };
    }
}
