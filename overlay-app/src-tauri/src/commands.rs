//! WebView から呼べるコマンド (spec §配置 lib/overlayBridge.js の裏側)。
//!
//! HTTP もファイルもホットキーも Rust 側だけが持ち、WebView は
//! ここを通してしか外に出られない。
//! @implements SPEC-WINDOW-OVERLAY-EXTENSION
use std::sync::Arc;

use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use crate::content::api_client::{ApiClient, LocalStatus, MarkerInput};
use crate::content::markdown_source::{self, MarkdownDocument, MarkdownSource, MarkdownWatcher};
use crate::hotkey::{self, HotkeyRegistry};
use crate::overlay::controller::OverlayController;
use crate::overlay::interactive_claims::is_webview_claim;
use crate::overlay::placement::Placement;
use crate::overlay::surface::SurfaceSpec;
use crate::overlay::surface_registry::{SurfaceDescriptor, SurfaceRegistry, SurfaceRequest};
use crate::overlay::tracker::TrackerSnapshot;
use crate::overlay::window_target::{WindowInfo, WindowTarget};
use crate::profile::{ActiveProfile, OverlayProfile, ProfileStore};

#[tauri::command]
pub fn overlay_list_windows(
    controller: State<'_, Arc<OverlayController>>,
) -> Result<Vec<WindowInfo>, String> {
    controller.list_windows()
}

#[tauri::command]
pub fn overlay_begin_pick(controller: State<'_, Arc<OverlayController>>) {
    controller.begin_pick();
}

#[tauri::command]
pub fn overlay_set_target(
    controller: State<'_, Arc<OverlayController>>,
    target: WindowTarget,
) -> TrackerSnapshot {
    controller.set_target(target);
    controller.snapshot()
}

#[tauri::command]
pub fn overlay_tracker_state(controller: State<'_, Arc<OverlayController>>) -> TrackerSnapshot {
    controller.snapshot()
}

#[tauri::command]
pub fn overlay_apply_placement(
    controller: State<'_, Arc<OverlayController>>,
    placement: Placement,
) {
    controller.set_placement(placement);
}

#[tauri::command]
pub fn overlay_set_click_through(
    app: AppHandle,
    controller: State<'_, Arc<OverlayController>>,
    enabled: bool,
) -> Result<(), String> {
    controller.set_click_through(&app, enabled)
}

#[tauri::command]
pub fn overlay_set_interactive(
    app: AppHandle,
    controller: State<'_, Arc<OverlayController>>,
    claim: String,
    interactive: bool,
) -> Result<(), String> {
    if !is_webview_claim(&claim) {
        return Err(format!("未知の操作可能要求です: {claim}"));
    }
    controller.set_interactive(&app, &claim, interactive)
}

#[tauri::command]
pub fn overlay_start_dragging(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "overlay window is unavailable".to_string())?;
    window.start_dragging().map_err(|error| error.to_string())
}

// ---- 情報サーフェス (spec 追補) ----
// サーフェスは「見せるだけ」の面なので、クリック透過を解除するコマンドは
// 用意しない。attach / update / close の 3 つだけを WebView へ渡す。

#[tauri::command]
pub fn overlay_surface_attach(
    app: AppHandle,
    surfaces: State<'_, Arc<SurfaceRegistry>>,
    request: SurfaceRequest,
) -> Result<SurfaceDescriptor, String> {
    surfaces.attach(&app, request)
}

#[tauri::command]
pub fn overlay_surface_update(
    app: AppHandle,
    surfaces: State<'_, Arc<SurfaceRegistry>>,
    id: String,
    spec: Option<SurfaceSpec>,
    content: Option<Value>,
) -> Result<(), String> {
    surfaces.update(&app, &id, spec, content)
}

#[tauri::command]
pub fn overlay_surface_close(
    app: AppHandle,
    surfaces: State<'_, Arc<SurfaceRegistry>>,
    id: String,
) -> Result<(), String> {
    surfaces.close(&app, &id)
}

/// サーフェスのウインドウが起動直後に自分の内容を引き取る。
#[tauri::command]
pub fn overlay_surface_descriptor(
    surfaces: State<'_, Arc<SurfaceRegistry>>,
    id: String,
) -> Result<SurfaceDescriptor, String> {
    surfaces.descriptor(&id)
}

#[tauri::command]
pub async fn overlay_read_markdown(
    api: State<'_, ApiClient>,
    source: MarkdownSource,
) -> Result<MarkdownDocument, String> {
    markdown_source::read(&source, &api).await
}

#[tauri::command]
pub fn overlay_watch_markdown(
    app: AppHandle,
    watcher: State<'_, Arc<MarkdownWatcher>>,
    path: String,
) -> Result<(), String> {
    watcher.inner().watch(app, &path)
}

#[tauri::command]
pub fn overlay_unwatch_markdown(
    watcher: State<'_, Arc<MarkdownWatcher>>,
    path: String,
) -> Result<(), String> {
    watcher.inner().unwatch(&path)
}

/// グラフの source (api / file) を読む。inline は WebView 側で完結する。
#[tauri::command]
pub async fn overlay_read_json(
    api: State<'_, ApiClient>,
    source: MarkdownSource,
) -> Result<Value, String> {
    match source {
        MarkdownSource::Api { path } => api.read_json(&path).await,
        MarkdownSource::File { path } => {
            let text = std::fs::read_to_string(&path)
                .map_err(|error| format!("{path} を読めません: {error}"))?;
            serde_json::from_str(&text).map_err(|error| format!("{path} が JSON ではありません: {error}"))
        }
        MarkdownSource::Inline { .. } => Err("inline source は WebView 側で解決します".into()),
    }
}

#[tauri::command]
pub async fn overlay_local_status(api: State<'_, ApiClient>) -> Result<LocalStatus, String> {
    Ok(api.overlay_status().await)
}

#[tauri::command]
pub async fn overlay_post_marker(
    api: State<'_, ApiClient>,
    marker: MarkerInput,
) -> Result<Value, String> {
    api.post_marker(&marker).await
}

#[tauri::command]
pub fn overlay_list_profiles(store: State<'_, ProfileStore>) -> Result<Vec<String>, String> {
    store.list()
}

/// name を省いたら「最初のプロファイル (無ければ既定)」を返す。
#[tauri::command]
pub fn overlay_load_profile(
    app: AppHandle,
    store: State<'_, ProfileStore>,
    active: State<'_, ActiveProfile>,
    hotkeys: State<'_, HotkeyRegistry>,
    controller: State<'_, Arc<OverlayController>>,
    name: Option<String>,
) -> Result<OverlayProfile, String> {
    let profile = match name {
        Some(name) => store.load(&name)?,
        None => store.load_first()?,
    };
    let previous = active.get()?;
    apply_with_rollback(&app, &controller, &hotkeys, &profile, &previous)?;
    active.replace(profile.clone())?;
    Ok(profile)
}

#[tauri::command]
pub fn overlay_save_profile(
    app: AppHandle,
    store: State<'_, ProfileStore>,
    active: State<'_, ActiveProfile>,
    hotkeys: State<'_, HotkeyRegistry>,
    controller: State<'_, Arc<OverlayController>>,
    profile: OverlayProfile,
) -> Result<OverlayProfile, String> {
    profile.validate_native()?;
    hotkey::validate(&profile)?;
    let previous = active.get()?;
    apply_with_rollback(&app, &controller, &hotkeys, &profile, &previous)?;
    if let Err(error) = store.save(&profile) {
        let rollback = apply(&app, &controller, &hotkeys, &previous);
        return match rollback {
            Ok(()) => Err(error),
            Err(rollback_error) => Err(format!(
                "{error}; 保存失敗後に以前のプロファイルも復元できません: {rollback_error}"
            )),
        };
    }
    active.replace(profile.clone())?;
    Ok(profile)
}

fn apply_with_rollback(
    app: &AppHandle,
    controller: &Arc<OverlayController>,
    hotkeys: &HotkeyRegistry,
    profile: &OverlayProfile,
    previous: &OverlayProfile,
) -> Result<(), String> {
    if let Err(error) = apply(app, controller, hotkeys, profile) {
        let rollback = apply(app, controller, hotkeys, previous);
        return match rollback {
            Ok(()) => Err(error),
            Err(rollback_error) => Err(format!(
                "{error}; 以前のプロファイルも復元できません: {rollback_error}"
            )),
        };
    }
    Ok(())
}

/// プロファイルの内容を追従・配置・ホットキーへ反映する。
pub fn apply(
    app: &AppHandle,
    controller: &Arc<OverlayController>,
    hotkeys: &HotkeyRegistry,
    profile: &OverlayProfile,
) -> Result<(), String> {
    // parse/registration failure must not first switch the tracked window.
    hotkey::register(app, hotkeys, profile)?;
    controller.set_target(profile.target.clone());
    controller.set_placement(profile.placement);
    controller.set_follow_z_order(profile.follow_z_order);
    controller.set_click_through(app, profile.click_through)?;
    controller.refresh_unbound_window(app)
}
