//! ウインドウ追従の骨格 (spec §追従ループ)。
//!
//! OS 依存は `WindowTracker` の向こう側に閉じ込め、状態遷移
//! (可視 → 最小化 → 復帰 → 破棄) はここで持つ。イベント駆動を第一とし、
//! ポーリングはバックアップに留める (`POLL_INTERVAL`)。
//! @implements SPEC-WINDOW-OVERLAY-EXTENSION
use std::time::Duration;

use serde::Serialize;

use super::placement::Rect;
use super::window_target::{WindowInfo, WindowTarget};

/// イベントが取れない環境向けのバックアップ間隔。常時ポーリングで
/// ゲームのフレームを削らないよう、これを上限とする。
pub const POLL_INTERVAL: Duration = Duration::from_millis(100);

#[derive(Debug, thiserror::Error)]
pub enum TrackerError {
    /// X11 に繋がらない / Wayland のような環境。手動配置へ落とす合図。
    #[cfg_attr(target_os = "windows", allow(dead_code))]
    #[error("window tracking is not supported on this platform: {0}")]
    Unsupported(String),
    #[error("window tracking failed: {0}")]
    Failed(String),
}

/// OS 別実装が満たす契約。位置取得と列挙だけを要求し、変化検知の方式
/// (SetWinEventHook / AX 通知 / ConfigureNotify) は実装側の自由にする。
pub trait WindowTracker: Send + Sync {
    fn list_windows(&self) -> Result<Vec<WindowInfo>, TrackerError>;
    fn window(&self, id: u64) -> Result<Option<WindowInfo>, TrackerError>;
    fn monitors(&self) -> Result<Vec<Rect>, TrackerError>;
    fn foreground_window(&self) -> Result<Option<u64>, TrackerError>;
    /// Wayland のように他クライアントの位置を取れない環境は false を返し、
    /// 呼び出し側は手動配置モードへ落ちる。
    fn supports_following(&self) -> bool {
        true
    }
    fn name(&self) -> &'static str;
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum TrackerEvent {
    /// 対象に接続した (初回・再バインドの両方)。
    Bound { id: u64, title: String, rect: Rect },
    /// 位置・サイズが変わった。
    Moved { rect: Rect },
    /// 最小化・非表示になった。オーバーレイも隠す。
    Hidden,
    /// 最小化から戻った。
    Restored { rect: Rect },
    /// 対象がフォアグラウンドから外れた / 戻った (followZOrder 用)。
    ForegroundChanged { foreground: bool },
    /// 対象が閉じられた。UI は再バインド待ちを出す。
    Lost,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TrackerSnapshot {
    /// 使っている OS 実装 (windows / macos / x11 / manual)。
    pub tracker: String,
    pub bound: bool,
    pub visible: bool,
    pub foreground: bool,
    pub title: Option<String>,
    pub rect: Option<Rect>,
    /// 対象のビュー領域 (情報サーフェスの追従基準)。外枠 `rect` とは別に持つ。
    #[serde(rename = "viewRect")]
    pub view_rect: Option<Rect>,
    #[serde(rename = "followsAutomatically")]
    pub follows_automatically: bool,
}

/// 対象 1 つ分の追従状態。`poll` を呼ぶたびに差分をイベントで返す。
#[derive(Debug, Default)]
pub struct TrackerSession {
    target: WindowTarget,
    bound_id: Option<u64>,
    rect: Option<Rect>,
    view_rect: Option<Rect>,
    title: Option<String>,
    visible: bool,
    foreground: bool,
}

impl TrackerSession {
    /// 単体テストと、対象を先に決めて起動する経路で使う。
    #[cfg_attr(target_os = "windows", allow(dead_code))]
    pub fn new(target: WindowTarget) -> Self {
        Self { target, ..Self::default() }
    }

    /// 対象を差し替える。接続中だったウインドウからは離れる。
    pub fn set_target(&mut self, target: WindowTarget) {
        self.target = target;
        self.bound_id = None;
        self.rect = None;
        self.view_rect = None;
        self.title = None;
        self.visible = false;
        self.foreground = false;
    }

    #[cfg_attr(target_os = "windows", allow(dead_code))]
    pub fn bound_id(&self) -> Option<u64> {
        self.bound_id
    }

    /// 情報サーフェスの追従基準。外枠ではなくクライアント領域を返す
    /// (spec 追補 §不変条件 2)。
    pub fn view_rect(&self) -> Option<Rect> {
        self.view_rect
    }

    pub fn snapshot(&self, tracker: &dyn WindowTracker) -> TrackerSnapshot {
        TrackerSnapshot {
            tracker: tracker.name().to_string(),
            bound: self.bound_id.is_some(),
            visible: self.visible,
            foreground: self.foreground,
            title: self.title.clone(),
            rect: self.rect,
            view_rect: self.view_rect,
            follows_automatically: tracker.supports_following(),
        }
    }

    /// An unbound window stays visible when the user must configure a target
    /// or the platform only supports manual placement.
    pub fn should_show_configuration(&self, tracker: &dyn WindowTracker) -> bool {
        self.bound_id.is_none() && (self.target.is_empty() || !tracker.supports_following())
    }

    pub fn poll(&mut self, tracker: &dyn WindowTracker) -> Result<Vec<TrackerEvent>, TrackerError> {
        let mut events = Vec::new();
        let current = match self.bound_id {
            Some(id) => tracker.window(id)?,
            None => None,
        };
        match current {
            None if self.bound_id.is_some() => self.release_and_rebind(tracker, &mut events)?,
            None => self.try_bind(tracker, &mut events)?,
            // Native handles/XIDs can be reused after a window is destroyed.
            // Revalidate the durable target identity before accepting the
            // current record for the previously bound numeric ID.
            Some(info) if !self.target.matches(&info) => {
                self.release_and_rebind(tracker, &mut events)?;
            }
            Some(info) => self.apply(info, tracker, &mut events)?,
        }
        Ok(events)
    }

    fn release_and_rebind(
        &mut self,
        tracker: &dyn WindowTracker,
        events: &mut Vec<TrackerEvent>,
    ) -> Result<(), TrackerError> {
        self.bound_id = None;
        self.rect = None;
        self.view_rect = None;
        self.title = None;
        self.visible = false;
        self.foreground = false;
        events.push(TrackerEvent::Lost);
        self.try_bind(tracker, events)
    }

    fn try_bind(
        &mut self,
        tracker: &dyn WindowTracker,
        events: &mut Vec<TrackerEvent>,
    ) -> Result<(), TrackerError> {
        if self.target.is_empty() {
            return Ok(());
        }
        let windows = tracker.list_windows()?;
        let Some(found) = self.target.resolve(&windows) else {
            return Ok(());
        };
        self.bound_id = Some(found.id);
        self.rect = Some(found.rect);
        self.view_rect = Some(found.view_rect);
        self.title = Some(found.title.clone());
        self.visible = !found.is_minimized;
        self.foreground = tracker.foreground_window()? == Some(found.id);
        events.push(TrackerEvent::Bound {
            id: found.id,
            title: found.title.clone(),
            rect: found.rect,
        });
        if !self.visible {
            events.push(TrackerEvent::Hidden);
        }
        Ok(())
    }

    fn apply(
        &mut self,
        info: WindowInfo,
        tracker: &dyn WindowTracker,
        events: &mut Vec<TrackerEvent>,
    ) -> Result<(), TrackerError> {
        let visible = !info.is_minimized;
        if visible != self.visible {
            self.visible = visible;
            events.push(if visible {
                TrackerEvent::Restored { rect: info.rect }
            } else {
                TrackerEvent::Hidden
            });
        }
        if self.visible && self.rect != Some(info.rect) {
            events.push(TrackerEvent::Moved { rect: info.rect });
        }
        self.rect = Some(info.rect);
        self.view_rect = Some(info.view_rect);
        if self.title.as_deref() != Some(info.title.as_str()) {
            self.title = Some(info.title.clone());
        }
        let foreground = tracker.foreground_window()? == Some(info.id);
        if foreground != self.foreground {
            self.foreground = foreground;
            events.push(TrackerEvent::ForegroundChanged { foreground });
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// trait のモック実装。OS を触らずに状態遷移だけを見る。
    #[derive(Default)]
    struct FakeTracker {
        windows: Mutex<Vec<WindowInfo>>,
        foreground: Mutex<Option<u64>>,
        follows: bool,
    }

    impl FakeTracker {
        fn with(windows: Vec<WindowInfo>) -> Self {
            Self {
                windows: Mutex::new(windows),
                foreground: Mutex::new(None),
                follows: true,
            }
        }

        fn set_windows(&self, windows: Vec<WindowInfo>) {
            *self.windows.lock().unwrap() = windows;
        }

        fn set_foreground(&self, id: Option<u64>) {
            *self.foreground.lock().unwrap() = id;
        }
    }

    impl WindowTracker for FakeTracker {
        fn list_windows(&self) -> Result<Vec<WindowInfo>, TrackerError> {
            Ok(self.windows.lock().unwrap().clone())
        }

        fn window(&self, id: u64) -> Result<Option<WindowInfo>, TrackerError> {
            Ok(self
                .windows
                .lock()
                .unwrap()
                .iter()
                .find(|window| window.id == id)
                .cloned())
        }

        fn monitors(&self) -> Result<Vec<Rect>, TrackerError> {
            Ok(vec![Rect::new(0, 0, 1920, 1080)])
        }

        fn foreground_window(&self) -> Result<Option<u64>, TrackerError> {
            Ok(*self.foreground.lock().unwrap())
        }

        fn supports_following(&self) -> bool {
            self.follows
        }

        fn name(&self) -> &'static str {
            "fake"
        }
    }

    fn window(id: u64, rect: Rect, minimized: bool) -> WindowInfo {
        WindowInfo {
            id,
            title: "Game".into(),
            process_name: "game.exe".into(),
            rect,
            // クライアント領域は外枠より一回り小さい、という現実に寄せる。
            view_rect: Rect::new(rect.x + 8, rect.y + 30, rect.width - 16, rect.height - 38),
            is_minimized: minimized,
        }
    }

    #[test]
    fn the_visible_minimized_restored_destroyed_cycle_emits_each_transition() {
        let tracker = FakeTracker::with(vec![window(1, Rect::new(0, 0, 800, 600), false)]);
        let mut session = TrackerSession::new(WindowTarget::by_process("game.exe"));

        let bound = session.poll(&tracker).unwrap();
        assert_eq!(
            bound,
            vec![TrackerEvent::Bound {
                id: 1,
                title: "Game".into(),
                rect: Rect::new(0, 0, 800, 600)
            }]
        );
        assert!(session.snapshot(&tracker).visible);

        tracker.set_windows(vec![window(1, Rect::new(20, 40, 800, 600), false)]);
        assert_eq!(
            session.poll(&tracker).unwrap(),
            vec![TrackerEvent::Moved { rect: Rect::new(20, 40, 800, 600) }]
        );

        tracker.set_windows(vec![window(1, Rect::new(20, 40, 800, 600), true)]);
        assert_eq!(session.poll(&tracker).unwrap(), vec![TrackerEvent::Hidden]);
        assert!(!session.snapshot(&tracker).visible);

        tracker.set_windows(vec![window(1, Rect::new(20, 40, 800, 600), false)]);
        assert_eq!(
            session.poll(&tracker).unwrap(),
            vec![TrackerEvent::Restored { rect: Rect::new(20, 40, 800, 600) }]
        );

        tracker.set_windows(vec![]);
        assert_eq!(session.poll(&tracker).unwrap(), vec![TrackerEvent::Lost]);
        assert!(!session.snapshot(&tracker).bound);
    }

    #[test]
    fn a_destroyed_window_rebinds_to_a_new_one_from_the_same_app() {
        let tracker = FakeTracker::with(vec![window(1, Rect::new(0, 0, 800, 600), false)]);
        let mut session = TrackerSession::new(WindowTarget::by_process("game.exe"));
        session.poll(&tracker).unwrap();

        tracker.set_windows(vec![window(2, Rect::new(10, 10, 640, 480), false)]);
        let events = session.poll(&tracker).unwrap();
        assert_eq!(events[0], TrackerEvent::Lost);
        assert!(matches!(events[1], TrackerEvent::Bound { id: 2, .. }));
        assert_eq!(session.bound_id(), Some(2));
    }

    #[test]
    fn a_reused_native_id_is_revalidated_before_it_can_move_the_overlay() {
        let tracker = FakeTracker::with(vec![window(1, Rect::new(0, 0, 800, 600), false)]);
        let mut session = TrackerSession::new(WindowTarget::by_process("game.exe"));
        session.poll(&tracker).unwrap();

        tracker.set_windows(vec![WindowInfo {
            id: 1,
            title: "Unrelated".into(),
            process_name: "other.exe".into(),
            rect: Rect::new(100, 100, 400, 300),
            view_rect: Rect::new(100, 100, 400, 300),
            is_minimized: false,
        }]);

        assert_eq!(session.poll(&tracker).unwrap(), vec![TrackerEvent::Lost]);
        assert_eq!(session.bound_id(), None);
        assert!(!session.snapshot(&tracker).visible);
    }

    #[test]
    fn foreground_changes_are_reported_for_follow_z_order() {
        let tracker = FakeTracker::with(vec![window(1, Rect::new(0, 0, 800, 600), false)]);
        let mut session = TrackerSession::new(WindowTarget::by_process("game.exe"));
        session.poll(&tracker).unwrap();
        tracker.set_foreground(Some(1));
        assert_eq!(
            session.poll(&tracker).unwrap(),
            vec![TrackerEvent::ForegroundChanged { foreground: true }]
        );
        tracker.set_foreground(Some(9));
        assert_eq!(
            session.poll(&tracker).unwrap(),
            vec![TrackerEvent::ForegroundChanged { foreground: false }]
        );
    }

    #[test]
    fn a_minimized_window_binds_but_stays_hidden() {
        let tracker = FakeTracker::with(vec![window(1, Rect::new(0, 0, 800, 600), true)]);
        let mut session = TrackerSession::new(WindowTarget::by_process("game.exe"));
        let events = session.poll(&tracker).unwrap();
        assert!(matches!(events[0], TrackerEvent::Bound { .. }));
        assert_eq!(events[1], TrackerEvent::Hidden);
    }

    #[test]
    fn nothing_happens_while_no_target_matches() {
        let tracker = FakeTracker::with(vec![window(1, Rect::new(0, 0, 10, 10), false)]);
        let mut session = TrackerSession::new(WindowTarget::by_process("other.exe"));
        assert!(session.poll(&tracker).unwrap().is_empty());
        let snapshot = session.snapshot(&tracker);
        assert!(!snapshot.bound);
        assert_eq!(snapshot.tracker, "fake");

        let mut empty = TrackerSession::new(WindowTarget::default());
        assert!(empty.poll(&tracker).unwrap().is_empty());
    }

    #[test]
    fn changing_the_target_releases_the_previous_window() {
        let tracker = FakeTracker::with(vec![
            window(1, Rect::new(0, 0, 800, 600), false),
            WindowInfo {
                id: 2,
                title: "Editor".into(),
                process_name: "editor.exe".into(),
                rect: Rect::new(100, 100, 400, 300),
                view_rect: Rect::new(100, 100, 400, 300),
                is_minimized: false,
            },
        ]);
        let mut session = TrackerSession::new(WindowTarget::by_process("game.exe"));
        session.poll(&tracker).unwrap();
        session.set_target(WindowTarget::by_process("editor.exe"));
        assert_eq!(session.bound_id(), None);
        let events = session.poll(&tracker).unwrap();
        assert!(matches!(events[0], TrackerEvent::Bound { id: 2, .. }));
    }
}
