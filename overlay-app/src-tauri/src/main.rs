// Volputas ウインドウ表示拡張ツール (spec/feature/window-overlay-extension.md)。
// 起動・プラグイン登録・状態の組み立てだけを持ち、中身は各モジュールへ。
// @implements SPEC-WINDOW-OVERLAY-EXTENSION
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod content;
mod hotkey;
mod overlay;
mod profile;

use std::sync::Arc;

use tauri::Manager;

use content::api_client::ApiClient;
use content::markdown_source::MarkdownWatcher;
use hotkey::HotkeyRegistry;
use overlay::controller::OverlayController;
use profile::{default_directory, ActiveProfile, ProfileStore};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let store = ProfileStore::new(default_directory(app.path().app_config_dir().ok()));
            let profile = store.load_first()?;

            let controller = Arc::new(OverlayController::new(overlay::create_tracker()));
            app.manage(Arc::clone(&controller));
            app.manage(controller.surfaces());
            app.manage(store);
            app.manage(ActiveProfile::new(profile.clone()));
            app.manage(HotkeyRegistry::default());
            app.manage(ApiClient::from_environment()?);
            app.manage(Arc::new(MarkdownWatcher::new()));

            // 対象が見つかるまでオーバーレイは出さない (誤爆した位置で
            // ゲーム画面を覆わないため)。
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.hide();
            }
            let hotkeys = app.state::<HotkeyRegistry>();
            commands::apply(&handle, &controller, &hotkeys, &profile)?;
            controller.spawn(handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::overlay_list_windows,
            commands::overlay_begin_pick,
            commands::overlay_set_target,
            commands::overlay_tracker_state,
            commands::overlay_apply_placement,
            commands::overlay_set_click_through,
            commands::overlay_set_interactive,
            commands::overlay_start_dragging,
            commands::overlay_surface_attach,
            commands::overlay_surface_update,
            commands::overlay_surface_close,
            commands::overlay_surface_descriptor,
            commands::overlay_read_markdown,
            commands::overlay_watch_markdown,
            commands::overlay_unwatch_markdown,
            commands::overlay_read_json,
            commands::overlay_local_status,
            commands::overlay_post_marker,
            commands::overlay_list_profiles,
            commands::overlay_load_profile,
            commands::overlay_save_profile,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Volputas overlay");
}
