//! ウインドウ追従とオーバーレイ配置 (spec §ウインドウ追従)。
//!
//! OS 実装は `WindowTracker` trait の裏に隠し、選択はここだけで行う。
//! Wayland のように他クライアントの位置を取得できない環境は手動配置へ落とす。
//! @implements SPEC-WINDOW-OVERLAY-EXTENSION
pub mod controller;
pub mod interactive_claims;
pub mod placement;
pub mod surface;
pub mod surface_registry;
pub mod tracker;
pub mod tracker_manual;
pub mod view_rect;
pub mod window_target;

#[cfg(target_os = "windows")]
pub mod tracker_windows;

#[cfg(target_os = "macos")]
pub mod tracker_macos;

#[cfg(all(unix, not(target_os = "macos")))]
pub mod tracker_x11;

use tracker::WindowTracker;

/// この環境で使う追従実装を選ぶ。
pub fn create_tracker() -> Box<dyn WindowTracker> {
    #[cfg(target_os = "windows")]
    {
        Box::new(tracker_windows::WindowsTracker::new())
    }
    #[cfg(target_os = "macos")]
    {
        Box::new(tracker_macos::MacosTracker::new())
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        // Wayland セッションでは X11 に繋がっても他ウインドウの位置は
        // 取れない (XWayland 経由の一部だけ)。素直に手動配置へ落とす。
        if std::env::var_os("WAYLAND_DISPLAY").is_some() {
            return Box::new(tracker_manual::ManualTracker::new(
                "Wayland では他ウインドウの位置を取得できません (手動配置モード)",
            ));
        }
        match tracker_x11::X11Tracker::connect() {
            Ok(tracker) => Box::new(tracker),
            Err(error) => Box::new(tracker_manual::ManualTracker::new(error.to_string())),
        }
    }
}
