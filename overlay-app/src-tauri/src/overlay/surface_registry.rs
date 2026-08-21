//! 情報サーフェスのウインドウ管理 (spec 追補 §呼び出し / §不変条件)。
//!
//! サーフェスは対象の矩形にクリップしない独立した透過ウインドウで、
//! 追従は対象の **ビュー領域** に対して行う (外枠ではない)。
//! `set_ignore_cursor_events(true)` はここでしか設定せず、**解除する経路を
//! 一切持たない** — 操作を受ける面はパネル、見せるだけの面がサーフェス。
//! 矩形の計算そのものは `surface.rs` の純関数が持つ。
//! @implements SPEC-WINDOW-OVERLAY-EXTENSION
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

use super::placement::{monitor_for, Rect};
use super::surface::{resolve_surface_rect, SurfaceSpec};

/// サーフェスの内容が差し替わったことを、そのサーフェスのウインドウへ送る。
pub const EVENT_SURFACE_UPDATED: &str = "overlay://surface-updated";

const LABEL_PREFIX: &str = "surface-";

/// `attachInfo` の引数そのまま。`content` の解釈は WebView 側 (既存の
/// MarkdownPanel / ChartPanel) が持ち、Rust は矩形と寿命だけを見る。
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SurfaceRequest {
    #[serde(flatten)]
    pub spec: SurfaceSpec,
    #[serde(default)]
    pub content: Value,
}

/// サーフェスのウインドウが起動直後に読む記述。
#[derive(Debug, Clone, Serialize)]
pub struct SurfaceDescriptor {
    pub id: String,
    pub content: Value,
}

/// 追従の基準。対象のビュー領域と、そのビュー領域が載っているモニタ群。
#[derive(Debug, Clone, Default)]
struct Viewport {
    view: Option<Rect>,
    monitors: Vec<Rect>,
}

struct SurfaceEntry {
    spec: SurfaceSpec,
    content: Value,
}

#[derive(Default)]
pub struct SurfaceRegistry {
    entries: Mutex<HashMap<String, SurfaceEntry>>,
    viewport: Mutex<Viewport>,
    visible: Mutex<bool>,
    next_id: AtomicU64,
}

impl SurfaceRegistry {
    pub fn new() -> Self {
        Self { visible: Mutex::new(true), ..Self::default() }
    }

    fn lock_entries(&self) -> Result<std::sync::MutexGuard<'_, HashMap<String, SurfaceEntry>>, String> {
        self.entries.lock().map_err(|error| error.to_string())
    }

    /// 追従基準を差し替える。対象が動いた・リサイズされた・モニタが変わった
    /// たびに追従ループから呼ばれ、全サーフェスを置き直す。
    pub fn set_viewport(&self, app: &AppHandle, view: Option<Rect>, monitors: Vec<Rect>) {
        {
            let Ok(mut viewport) = self.viewport.lock() else { return };
            if viewport.view == view && viewport.monitors == monitors {
                return;
            }
            *viewport = Viewport { view, monitors };
        }
        self.reposition_all(app);
    }

    /// 対象が隠れた・失われたらサーフェスも隠す (対象と一蓮托生)。
    pub fn set_visible(&self, app: &AppHandle, visible: bool) {
        {
            let Ok(mut current) = self.visible.lock() else { return };
            if *current == visible {
                return;
            }
            *current = visible;
        }
        let Ok(entries) = self.lock_entries() else { return };
        for id in entries.keys() {
            self.show_window(app, id, visible);
        }
    }

    /// 情報サーフェスを 1 枚出す。
    /// @implements SPEC-WINDOW-OVERLAY-EXTENSION
    pub fn attach(
        &self,
        app: &AppHandle,
        request: SurfaceRequest,
    ) -> Result<SurfaceDescriptor, String> {
        let id = format!("{LABEL_PREFIX}{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let descriptor = SurfaceDescriptor { id: id.clone(), content: request.content.clone() };
        self.lock_entries()?
            .insert(id.clone(), SurfaceEntry { spec: request.spec, content: request.content });
        if let Err(error) = self.create_window(app, &id) {
            self.lock_entries()?.remove(&id);
            return Err(error);
        }
        self.reposition(app, &id);
        Ok(descriptor)
    }

    /// spec / content の部分更新。省略された側は現状を保つ。
    pub fn update(
        &self,
        app: &AppHandle,
        id: &str,
        spec: Option<SurfaceSpec>,
        content: Option<Value>,
    ) -> Result<(), String> {
        let updated_content = {
            let mut entries = self.lock_entries()?;
            let entry = entries
                .get_mut(id)
                .ok_or_else(|| format!("情報サーフェス {id} は存在しません"))?;
            if let Some(spec) = spec {
                entry.spec = spec;
            }
            match content {
                Some(content) => {
                    entry.content = content.clone();
                    Some(content)
                }
                None => None,
            }
        };
        if let Some(content) = updated_content {
            let _ = app.emit_to(
                id,
                EVENT_SURFACE_UPDATED,
                SurfaceDescriptor { id: id.to_string(), content },
            );
        }
        self.reposition(app, id);
        Ok(())
    }

    pub fn close(&self, app: &AppHandle, id: &str) -> Result<(), String> {
        if self.lock_entries()?.remove(id).is_none() {
            return Err(format!("情報サーフェス {id} は存在しません"));
        }
        if let Some(window) = app.get_webview_window(id) {
            window.close().map_err(|error| error.to_string())?;
        }
        Ok(())
    }

    /// サーフェスのウインドウが起動直後に自分の内容を引き取る。
    pub fn descriptor(&self, id: &str) -> Result<SurfaceDescriptor, String> {
        let entries = self.lock_entries()?;
        let entry = entries
            .get(id)
            .ok_or_else(|| format!("情報サーフェス {id} は存在しません"))?;
        Ok(SurfaceDescriptor { id: id.to_string(), content: entry.content.clone() })
    }

    pub fn ids(&self) -> Vec<String> {
        self.lock_entries()
            .map(|entries| entries.keys().cloned().collect())
            .unwrap_or_default()
    }

    fn create_window(&self, app: &AppHandle, id: &str) -> Result<(), String> {
        let url = WebviewUrl::App(format!("index.html?surface={id}").into());
        let window = WebviewWindowBuilder::new(app, id, url)
            .title("Volputas Info Surface")
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .shadow(false)
            .resizable(false)
            .focused(false)
            .visible(false)
            .build()
            .map_err(|error| error.to_string())?;
        // 不変条件 1: タップイベントは常に貫通する。ここで一度だけ立て、
        // 解除する API はレジストリにもコマンドにも用意しない。
        window
            .set_ignore_cursor_events(true)
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    fn reposition_all(&self, app: &AppHandle) {
        for id in self.ids() {
            self.reposition(app, &id);
        }
    }

    fn reposition(&self, app: &AppHandle, id: &str) {
        let Some(rect) = self.rect_for(id) else {
            // 追従基準がまだ無い (対象未接続) 間は出さない。
            self.show_window(app, id, false);
            return;
        };
        let Some(window) = app.get_webview_window(id) else { return };
        let _ = window.set_position(PhysicalPosition::new(rect.x, rect.y));
        let _ = window.set_size(PhysicalSize::new(
            rect.width.max(1) as u32,
            rect.height.max(1) as u32,
        ));
        let visible = self.visible.lock().map(|visible| *visible).unwrap_or(true);
        self.show_window(app, id, visible);
    }

    /// 追従の基準はビュー領域、クランプの基準はそれが載っているモニタ。
    fn rect_for(&self, id: &str) -> Option<Rect> {
        let viewport = self.viewport.lock().ok()?;
        let view = viewport.view?;
        let monitor = monitor_for(&view, &viewport.monitors)?;
        let entries = self.lock_entries().ok()?;
        let entry = entries.get(id)?;
        Some(resolve_surface_rect(view, monitor, &entry.spec))
    }

    fn show_window(&self, app: &AppHandle, id: &str, visible: bool) {
        let Some(window) = app.get_webview_window(id) else { return };
        let _ = if visible { window.show() } else { window.hide() };
    }
}

#[cfg(test)]
mod tests {
    /// 不変条件 1 の番人。サーフェスのウインドウ操作はこのファイルに閉じて
    /// いるので、ここに解除の呼び出しが増えていないことを見れば足りる。
    const REGISTRY_FILE: &str = include_str!("surface_registry.rs");
    /// サーフェス向けコマンドの一覧もここで固定する。
    const COMMANDS_SOURCE: &str = include_str!("../commands.rs");

    /// テストモジュール自身の文字列を数えないよう、実装部分だけを見る。
    fn registry_implementation() -> &'static str {
        REGISTRY_FILE.split("#[cfg(test)]").next().unwrap_or(REGISTRY_FILE)
    }

    #[test]
    fn a_surface_never_releases_click_through() {
        let source = registry_implementation();
        assert!(
            source.contains("set_ignore_cursor_events(true)"),
            "サーフェスは生成時にクリック透過を立てる"
        );
        assert!(
            !source.contains("set_ignore_cursor_events(false)"),
            "サーフェスにクリック透過を解除する経路を作らない (spec 追補 §不変条件 1)"
        );
        // パネル側の操作可能状態 (グラブハンドル / hover) をサーフェスへ
        // 持ち込まない。ドラッグ移動も同様に持たせない。
        assert!(!source.contains("set_interactive"));
        assert!(!source.contains("start_dragging"));
    }

    #[test]
    fn the_surface_commands_are_attach_update_close_and_descriptor_only() {
        let surface_commands: Vec<&str> = COMMANDS_SOURCE
            .lines()
            .filter_map(|line| line.trim().strip_prefix("pub fn overlay_surface_"))
            .filter_map(|line| line.split('(').next())
            .collect();
        assert_eq!(
            surface_commands,
            vec!["attach", "update", "close", "descriptor"],
            "サーフェスへ操作を渡すコマンドを増やさない"
        );
    }
}
