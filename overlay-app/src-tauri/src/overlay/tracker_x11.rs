//! Linux (X11) 実装 (spec §追従ループ)。
//!
//! 位置は `GetGeometry` + `TranslateCoordinates`、一覧は `_NET_CLIENT_LIST`。
//! 変化検知は StructureNotify (`ConfigureNotify`) を購読する。
//! Wayland ではこの実装は使えないので、呼び出し側が tracker_manual へ落ちる。
//! @implements SPEC-WINDOW-OVERLAY-EXTENSION
#![cfg(all(unix, not(target_os = "macos")))]

use x11rb::connection::Connection;
use x11rb::protocol::xproto::{AtomEnum, ConnectionExt, EventMask, Window};
use x11rb::rust_connection::RustConnection;

use super::placement::Rect;
use super::tracker::{TrackerError, WindowTracker};
use super::view_rect::FrameInsets;
use super::window_target::WindowInfo;

pub struct X11Tracker {
    connection: RustConnection,
    root: Window,
}

fn failed(error: impl std::fmt::Display) -> TrackerError {
    TrackerError::Failed(error.to_string())
}

impl X11Tracker {
    /// X11 が無い環境 (Wayland 単独など) では Unsupported を返す。
    pub fn connect() -> Result<Self, TrackerError> {
        let (connection, screen_number) = x11rb::connect(None)
            .map_err(|error| TrackerError::Unsupported(error.to_string()))?;
        let root = connection.setup().roots[screen_number].root;
        Ok(Self { connection, root })
    }

    fn atom(&self, name: &str) -> Result<u32, TrackerError> {
        Ok(self
            .connection
            .intern_atom(false, name.as_bytes())
            .map_err(failed)?
            .reply()
            .map_err(failed)?
            .atom)
    }

    fn text_property(&self, window: Window, name: &str) -> Result<String, TrackerError> {
        let property = self.atom(name)?;
        let reply = self
            .connection
            .get_property(false, window, property, AtomEnum::ANY, 0, 1024)
            .map_err(failed)?
            .reply()
            .map_err(failed)?;
        Ok(String::from_utf8_lossy(&reply.value).trim_end_matches('\0').to_string())
    }

    /// `_NET_FRAME_EXTENTS` (left, right, top, bottom)。WM が装飾の厚みを
    /// 公開していない環境では 0 扱いにし、外枠 = inner geometry とする。
    fn frame_extents(&self, window: Window) -> FrameInsets {
        let Ok(property) = self.atom("_NET_FRAME_EXTENTS") else {
            return FrameInsets::default();
        };
        let Ok(cookie) = self
            .connection
            .get_property(false, window, property, AtomEnum::CARDINAL, 0, 4)
        else {
            return FrameInsets::default();
        };
        let Ok(reply) = cookie.reply() else {
            return FrameInsets::default();
        };
        let values: Vec<u32> = reply.value32().map(|values| values.collect()).unwrap_or_default();
        if values.len() < 4 {
            return FrameInsets::default();
        }
        FrameInsets {
            left: values[0] as i32,
            right: values[1] as i32,
            top: values[2] as i32,
            bottom: values[3] as i32,
        }
    }

    /// `GetGeometry` の width/height は border を含まない inner geometry で、
    /// `TranslateCoordinates` の原点もその内側を指す (spec 追補 §ビュー領域の取得)。
    fn geometry(&self, window: Window) -> Result<Rect, TrackerError> {
        let geometry = self
            .connection
            .get_geometry(window)
            .map_err(failed)?
            .reply()
            .map_err(failed)?;
        // 親相対の座標をルート座標へ直す。
        let translated = self
            .connection
            .translate_coordinates(window, self.root, 0, 0)
            .map_err(failed)?
            .reply()
            .map_err(failed)?;
        Ok(Rect::new(
            translated.dst_x as i32,
            translated.dst_y as i32,
            geometry.width as i32,
            geometry.height as i32,
        ))
    }

    fn client_list(&self) -> Result<Vec<Window>, TrackerError> {
        let property = self.atom("_NET_CLIENT_LIST")?;
        let reply = self
            .connection
            .get_property(false, self.root, property, AtomEnum::WINDOW, 0, 4096)
            .map_err(failed)?
            .reply()
            .map_err(failed)?;
        Ok(reply.value32().map(|values| values.collect()).unwrap_or_default())
    }

    fn info(&self, window: Window) -> Result<WindowInfo, TrackerError> {
        let title = self
            .text_property(window, "_NET_WM_NAME")
            .unwrap_or_default();
        let class = self.text_property(window, "WM_CLASS").unwrap_or_default();
        let state = self.text_property(window, "_NET_WM_STATE").unwrap_or_default();
        // inner geometry がそのままビュー領域。外枠は WM の装飾を足して作る。
        let view_rect = self.geometry(window)?;
        let insets = self.frame_extents(window);
        Ok(WindowInfo {
            id: window as u64,
            title,
            // WM_CLASS は "instance\0class" なので先頭を使う。
            process_name: class.split('\0').next().unwrap_or_default().to_string(),
            rect: Rect::new(
                view_rect.x - insets.left,
                view_rect.y - insets.top,
                view_rect.width + insets.left + insets.right,
                view_rect.height + insets.top + insets.bottom,
            ),
            view_rect,
            is_minimized: state.contains("HIDDEN"),
        })
    }

    /// ルートに StructureNotify を張り、位置変更を購読する。
    pub fn subscribe_changes(&self) -> Result<(), TrackerError> {
        self.connection
            .change_window_attributes(
                self.root,
                &x11rb::protocol::xproto::ChangeWindowAttributesAux::new()
                    .event_mask(EventMask::STRUCTURE_NOTIFY | EventMask::SUBSTRUCTURE_NOTIFY),
            )
            .map_err(failed)?;
        self.connection.flush().map_err(failed)?;
        Ok(())
    }
}

impl WindowTracker for X11Tracker {
    fn list_windows(&self) -> Result<Vec<WindowInfo>, TrackerError> {
        let mut windows = Vec::new();
        for window in self.client_list()? {
            if let Ok(info) = self.info(window) {
                windows.push(info);
            }
        }
        Ok(windows)
    }

    fn window(&self, id: u64) -> Result<Option<WindowInfo>, TrackerError> {
        match self.info(id as Window) {
            Ok(info) => Ok(Some(info)),
            Err(_) => Ok(None),
        }
    }

    fn monitors(&self) -> Result<Vec<Rect>, TrackerError> {
        // RandR を引かずに済むよう、まずはスクリーン全体を 1 枚として返す。
        let screen = &self.connection.setup().roots[0];
        Ok(vec![Rect::new(
            0,
            0,
            screen.width_in_pixels as i32,
            screen.height_in_pixels as i32,
        )])
    }

    fn foreground_window(&self) -> Result<Option<u64>, TrackerError> {
        let property = self.atom("_NET_ACTIVE_WINDOW")?;
        let reply = self
            .connection
            .get_property(false, self.root, property, AtomEnum::WINDOW, 0, 1)
            .map_err(failed)?
            .reply()
            .map_err(failed)?;
        Ok(reply
            .value32()
            .and_then(|mut values| values.next())
            .map(|window| window as u64))
    }

    fn name(&self) -> &'static str {
        "x11"
    }
}
