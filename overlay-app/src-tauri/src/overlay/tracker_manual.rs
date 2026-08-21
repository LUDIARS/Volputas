//! 手動配置 fallback (spec §非目標 / §追従)。
//!
//! Wayland では他クライアントのウインドウ位置を取得できない。プロトコルを
//! 迂回する代わりに、追従を諦めてユーザが置いた位置に留まる。
//! `supports_following()` が false を返すので、UI は追従非対応を明示できる。
//! @implements SPEC-WINDOW-OVERLAY-EXTENSION
use std::sync::Mutex;

use super::placement::Rect;
use super::tracker::{TrackerError, WindowTracker};
use super::window_target::WindowInfo;

// Windows/macOS ビルドでは使わないが、Wayland fallback として同じ形で
// 保持する (create_tracker が unix でのみ構築する)。
#[cfg_attr(not(all(unix, not(target_os = "macos"))), allow(dead_code))]
pub struct ManualTracker {
    reason: String,
    // ユーザが指定した仮想的な「対象矩形」。detached 配置の基準に使う。
    surface: Mutex<Rect>,
}

#[cfg_attr(not(all(unix, not(target_os = "macos"))), allow(dead_code))]
impl ManualTracker {
    pub fn new(reason: impl Into<String>) -> Self {
        Self {
            reason: reason.into(),
            surface: Mutex::new(Rect::new(0, 0, 1920, 1080)),
        }
    }

    pub fn reason(&self) -> &str {
        &self.reason
    }

    pub fn set_surface(&self, rect: Rect) {
        if let Ok(mut surface) = self.surface.lock() {
            *surface = rect;
        }
    }
}

impl WindowTracker for ManualTracker {
    fn list_windows(&self) -> Result<Vec<WindowInfo>, TrackerError> {
        // 列挙できないことを空リストで表す。UI は手動配置モードを出す。
        // ビュー領域を知る手段も無いので、仮に列挙できたとしても
        // `view_rect` は外枠と同一になる (spec 追補 §ビュー領域の取得)。
        Ok(Vec::new())
    }

    fn window(&self, _id: u64) -> Result<Option<WindowInfo>, TrackerError> {
        Ok(None)
    }

    fn monitors(&self) -> Result<Vec<Rect>, TrackerError> {
        Ok(vec![*self.surface.lock().map_err(|error| {
            TrackerError::Failed(error.to_string())
        })?])
    }

    fn foreground_window(&self) -> Result<Option<u64>, TrackerError> {
        Ok(None)
    }

    fn supports_following(&self) -> bool {
        false
    }

    fn name(&self) -> &'static str {
        "manual"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::overlay::tracker::TrackerSession;
    use crate::overlay::window_target::WindowTarget;

    #[test]
    fn the_manual_fallback_never_binds_and_says_so() {
        let tracker = ManualTracker::new("wayland");
        assert!(!tracker.supports_following());
        assert_eq!(tracker.reason(), "wayland");
        let mut session = TrackerSession::new(WindowTarget::by_process("game.exe"));
        assert!(session.poll(&tracker).unwrap().is_empty());
        let snapshot = session.snapshot(&tracker);
        assert!(!snapshot.bound);
        assert!(!snapshot.follows_automatically);
        assert_eq!(snapshot.tracker, "manual");
        assert!(session.should_show_configuration(&tracker));
    }

    #[test]
    fn the_manual_surface_is_what_placement_uses_as_bounds() {
        let tracker = ManualTracker::new("wayland");
        tracker.set_surface(Rect::new(0, 0, 1280, 720));
        assert_eq!(tracker.monitors().unwrap(), vec![Rect::new(0, 0, 1280, 720)]);
    }
}
