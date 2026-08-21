//! グローバルホットキー → マーカー投下 (spec §感想拾い / task T7)。
//!
//! クリック透過中でも効くよう、キーは OS 全体で受ける。コメント入力の
//! ホットキーだけは、押された瞬間にクリック透過を解除する。
//! @implements SPEC-WINDOW-OVERLAY-EXTENSION
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::overlay::controller::OverlayController;
use crate::overlay::interactive_claims::CLAIM_COMMENT;
use crate::profile::OverlayProfile;

pub const EVENT_MARKER_HOTKEY: &str = "overlay://marker-hotkey";
pub const EVENT_COMMENT_HOTKEY: &str = "overlay://comment-hotkey";

pub const COMMENT_ACTION: &str = "comment";
pub const MARKER_ACTIONS: [&str; 4] = ["hype", "like", "dislike", "stress"];

pub const DEFAULT_HOTKEYS: [(&str, &str); 5] = [
    ("hype", "Ctrl+Alt+1"),
    ("like", "Ctrl+Alt+2"),
    ("dislike", "Ctrl+Alt+3"),
    ("stress", "Ctrl+Alt+4"),
    ("comment", "Ctrl+Alt+Enter"),
];

#[derive(Debug, Clone, Serialize)]
struct MarkerHotkeyPayload {
    #[serde(rename = "type")]
    marker_type: String,
}

#[derive(Default)]
pub struct HotkeyRegistry {
    bindings: Mutex<Vec<(String, String)>>,
}

/// プロファイルの markers パネルから割り当てを読む。未指定は既定値。
pub fn bindings_of(profile: &OverlayProfile) -> BTreeMap<String, String> {
    if !profile
        .panels
        .iter()
        .any(|panel| panel.get("type").and_then(Value::as_str) == Some("markers"))
    {
        return BTreeMap::new();
    }
    let mut bindings: BTreeMap<String, String> = DEFAULT_HOTKEYS
        .iter()
        .map(|(action, binding)| ((*action).to_string(), (*binding).to_string()))
        .collect();
    for panel in &profile.panels {
        if panel.get("type").and_then(Value::as_str) != Some("markers") {
            continue;
        }
        let Some(hotkeys) = panel.get("hotkeys").and_then(Value::as_object) else {
            continue;
        };
        for (action, binding) in hotkeys {
            if let Some(binding) = binding.as_str() {
                if bindings.contains_key(action) {
                    bindings.insert(action.clone(), binding.to_string());
                }
            }
        }
    }
    bindings
}

/// プロファイル切替のたびに呼ぶ。前の割り当ては全部外してから張り直す。
fn shortcuts_of(profile: &OverlayProfile) -> Result<Vec<(String, String, Shortcut)>, String> {
    bindings_of(profile)
        .into_iter()
        .map(|(action, binding)| {
            let shortcut: Shortcut = binding
                .parse()
                .map_err(|error| format!("ホットキー {binding} を解釈できません: {error:?}"))?;
            Ok((action, binding, shortcut))
        })
        .collect()
}

pub fn validate(profile: &OverlayProfile) -> Result<(), String> {
    shortcuts_of(profile).map(|_| ())
}

fn register_parsed(
    app: &AppHandle,
    parsed: Vec<(String, String, Shortcut)>,
) -> Result<(), String> {
    let shortcuts = app.global_shortcut();
    for (action, binding, shortcut) in parsed {
        let action = action.clone();
        shortcuts
            .on_shortcut(shortcut, move |app, _shortcut, event| {
                if event.state() != ShortcutState::Pressed {
                    return;
                }
                dispatch(app, &action);
            })
            .map_err(|error| format!("ホットキー {binding} を登録できません: {error}"))?;
    }
    Ok(())
}

fn parse_bindings(bindings: &[(String, String)]) -> Result<Vec<(String, String, Shortcut)>, String> {
    bindings
        .iter()
        .map(|(action, binding)| {
            let shortcut: Shortcut = binding
                .parse()
                .map_err(|error| format!("ホットキー {binding} を解釈できません: {error:?}"))?;
            Ok((action.clone(), binding.clone(), shortcut))
        })
        .collect()
}

pub fn register(
    app: &AppHandle,
    registry: &HotkeyRegistry,
    profile: &OverlayProfile,
) -> Result<(), String> {
    // 全 binding を先に parse し、1 件の誤設定で現在の割り当てを失わない。
    let parsed = shortcuts_of(profile)?;
    let next_bindings = parsed
        .iter()
        .map(|(action, binding, _)| (action.clone(), binding.clone()))
        .collect::<Vec<_>>();
    let mut current = registry.bindings.lock().map_err(|error| error.to_string())?;
    if *current == next_bindings {
        return Ok(());
    }

    let previous = current.clone();
    let shortcuts = app.global_shortcut();
    shortcuts
        .unregister_all()
        .map_err(|error| format!("現在のホットキーを解除できません: {error}"))?;
    if let Err(error) = register_parsed(app, parsed) {
        let _ = shortcuts.unregister_all();
        let restored = parse_bindings(&previous).and_then(|bindings| register_parsed(app, bindings));
        return match restored {
            Ok(()) => Err(error),
            Err(restore_error) => Err(format!(
                "{error}; 以前のホットキーも復元できません: {restore_error}"
            )),
        };
    }
    *current = next_bindings;
    Ok(())
}

fn dispatch(app: &AppHandle, action: &str) {
    if action == COMMENT_ACTION {
        // コメント入力の間だけ操作を受ける (spec §クリック透過)。
        if let Some(controller) = app.try_state::<Arc<OverlayController>>() {
            let _ = controller.set_interactive(app, CLAIM_COMMENT, true);
        }
        let _ = app.emit(EVENT_COMMENT_HOTKEY, ());
        return;
    }
    if MARKER_ACTIONS.contains(&action) {
        let _ = app.emit(
            EVENT_MARKER_HOTKEY,
            MarkerHotkeyPayload { marker_type: action.to_string() },
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_defaults_match_the_spec() {
        let bindings = bindings_of(&OverlayProfile::fallback());
        assert_eq!(bindings.get("hype").map(String::as_str), Some("Ctrl+Alt+1"));
        assert_eq!(bindings.get("stress").map(String::as_str), Some("Ctrl+Alt+4"));
        assert_eq!(bindings.get("comment").map(String::as_str), Some("Ctrl+Alt+Enter"));
    }

    #[test]
    fn a_profile_can_override_one_binding_without_losing_the_others() {
        let mut profile = OverlayProfile::fallback();
        profile.panels = vec![serde_json::json!({
            "type": "markers",
            "hotkeys": { "hype": "Ctrl+Alt+9", "nonsense": "Ctrl+Alt+0" }
        })];
        let bindings = bindings_of(&profile);
        assert_eq!(bindings.get("hype").map(String::as_str), Some("Ctrl+Alt+9"));
        assert_eq!(bindings.get("like").map(String::as_str), Some("Ctrl+Alt+2"));
        // 知らない action は無視する (誤設定で全部落とさない)。
        assert!(!bindings.contains_key("nonsense"));
    }

    #[test]
    fn a_profile_without_a_marker_panel_registers_no_marker_hotkeys() {
        let mut profile = OverlayProfile::fallback();
        profile.panels = vec![serde_json::json!({ "type": "markdown" })];
        assert!(bindings_of(&profile).is_empty());
    }

    #[test]
    fn invalid_hotkeys_are_rejected_before_registration() {
        let mut profile = OverlayProfile::fallback();
        profile.panels = vec![serde_json::json!({
            "type": "markers",
            "hotkeys": { "hype": "not a shortcut" }
        })];
        assert!(validate(&profile).is_err());
    }
}
