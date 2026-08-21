//! プロファイルの保存と読み出し (spec §設定 / task T8)。
//!
//! 1 プロファイル = 「対象ウインドウ + 配置 + パネル構成」。
//! 意味づけ (既定値・妥当性) は WebView 側の profileSchema.js が正本で、
//! ここはファイル入出力と、Rust が使う型への写しだけを持つ。
//! @implements SPEC-WINDOW-OVERLAY-EXTENSION
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::overlay::placement::{Placement, PlacementMode};
use crate::overlay::window_target::WindowTarget;

const DIRECTORY: &str = "overlay-profiles";
const EXTENSION: &str = "json";

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OverlayProfile {
    #[serde(rename = "schemaVersion", default = "default_schema_version")]
    pub schema_version: u32,
    pub name: String,
    #[serde(default)]
    pub target: WindowTarget,
    #[serde(default)]
    pub placement: Placement,
    #[serde(rename = "followZOrder", default = "default_true")]
    pub follow_z_order: bool,
    #[serde(rename = "clickThrough", default = "default_true")]
    pub click_through: bool,
    /// パネル構成は WebView がそのまま解釈するので、Rust では素通しにする。
    #[serde(default)]
    pub panels: Vec<Value>,
}

fn default_schema_version() -> u32 {
    1
}

impl OverlayProfile {
    pub fn fallback() -> Self {
        Self {
            schema_version: 1,
            name: "default".into(),
            target: WindowTarget::default(),
            placement: Placement::default(),
            follow_z_order: true,
            click_through: true,
            panels: vec![serde_json::json!({ "type": "markers" })],
        }
    }

    /// Validate every field consumed by native code. The WebView performs the
    /// richer panel normalization, but profile files and IPC are native trust
    /// boundaries and cannot rely on that caller-side check.
    pub fn validate_native(&self) -> Result<(), String> {
        if self.schema_version != 1 {
            return Err(format!("未対応の schemaVersion: {}", self.schema_version));
        }
        if !is_safe_profile_name(&self.name) {
            return Err(format!("プロファイル名として使えません: {}", self.name));
        }
        if !(80..=8000).contains(&self.placement.width)
            || !(60..=8000).contains(&self.placement.height)
            || !(0..=400).contains(&self.placement.margin)
            || !self.placement.opacity.is_finite()
            || !(0.1..=1.0).contains(&self.placement.opacity)
        {
            return Err("placement の数値が許容範囲外です".into());
        }
        if let PlacementMode::Detached { x, y } = self.placement.mode {
            if !(-32000..=32000).contains(&x) || !(-32000..=32000).contains(&y) {
                return Err("detached placement の座標が許容範囲外です".into());
            }
        }
        if self.target.process_name.as_deref().unwrap_or("").chars().count() > 200 {
            return Err("target.processName が長すぎます".into());
        }
        if let Some(pattern) = self.target.title_pattern.as_deref().filter(|value| !value.is_empty()) {
            if pattern.chars().count() > 400 {
                return Err("target.titlePattern が長すぎます".into());
            }
            regex::Regex::new(pattern)
                .map_err(|error| format!("target.titlePattern が不正です: {error}"))?;
        }
        Ok(())
    }
}

/// The profile currently applied to native resources. Save/load commands use
/// this snapshot to roll back hotkeys and window state when a transition fails.
pub struct ActiveProfile {
    profile: Mutex<OverlayProfile>,
}

impl ActiveProfile {
    pub fn new(profile: OverlayProfile) -> Self {
        Self { profile: Mutex::new(profile) }
    }

    pub fn get(&self) -> Result<OverlayProfile, String> {
        self.profile.lock().map(|profile| profile.clone()).map_err(|error| error.to_string())
    }

    pub fn replace(&self, profile: OverlayProfile) -> Result<(), String> {
        *self.profile.lock().map_err(|error| error.to_string())? = profile;
        Ok(())
    }
}

/// ファイル名に使える名前だけを通す。表示名を兼ねるため Unicode と空白は
/// 許可するが、Windows を含む各 OS の区切り・予約記号は拒否する。
pub fn is_safe_profile_name(name: &str) -> bool {
    !name.is_empty()
        && name.chars().count() <= 64
        && !name.starts_with('.')
        && !name.ends_with('.')
        && !name.ends_with(' ')
        && name
            .chars()
            .all(|value| {
                !value.is_control()
                    && !matches!(value, '/' | '\\' | '<' | '>' | ':' | '"' | '|' | '?' | '*')
            })
}

fn reject_symlink(path: &std::path::Path) -> Result<(), String> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            Err(format!("symlink profile is not allowed: {}", path.display()))
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("{} を確認できません: {error}", path.display())),
    }
}

pub struct ProfileStore {
    directory: PathBuf,
}

impl ProfileStore {
    pub fn new(directory: impl Into<PathBuf>) -> Self {
        Self { directory: directory.into() }
    }

    fn path_for(&self, name: &str) -> Result<PathBuf, String> {
        if !is_safe_profile_name(name) {
            return Err(format!("プロファイル名として使えません: {name}"));
        }
        Ok(self.directory.join(format!("{name}.{EXTENSION}")))
    }

    pub fn list(&self) -> Result<Vec<String>, String> {
        let entries = match std::fs::read_dir(&self.directory) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(error.to_string()),
        };
        let mut names = Vec::new();
        for entry in entries.flatten() {
            if entry.file_type().map(|kind| kind.is_symlink()).unwrap_or(true) {
                continue;
            }
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some(EXTENSION) {
                continue;
            }
            if let Some(name) = path.file_stem().and_then(|value| value.to_str()) {
                if is_safe_profile_name(name) {
                    names.push(name.to_string());
                }
            }
        }
        names.sort();
        Ok(names)
    }

    pub fn load(&self, name: &str) -> Result<OverlayProfile, String> {
        let path = self.path_for(name)?;
        reject_symlink(&path)?;
        let text = std::fs::read_to_string(&path)
            .map_err(|error| format!("{} を読めません: {error}", path.display()))?;
        let profile: OverlayProfile = serde_json::from_str(&text)
            .map_err(|error| format!("{} が壊れています: {error}", path.display()))?;
        profile.validate_native()?;
        Ok(profile)
    }

    /// 名前を指定しない読み出し。ファイルが無い場合だけ既定を返し、
    /// 壊れた profile や I/O failure は黙って既定へ落とさない。
    pub fn load_first(&self) -> Result<OverlayProfile, String> {
        match self.list()?.into_iter().next() {
            Some(name) => self.load(&name),
            None => Ok(OverlayProfile::fallback()),
        }
    }

    pub fn save(&self, profile: &OverlayProfile) -> Result<PathBuf, String> {
        profile.validate_native()?;
        let path = self.path_for(&profile.name)?;
        std::fs::create_dir_all(&self.directory).map_err(|error| error.to_string())?;
        reject_symlink(&path)?;
        let text = serde_json::to_string_pretty(profile).map_err(|error| error.to_string())?;
        std::fs::write(&path, text)
            .map_err(|error| format!("{} を書けません: {error}", path.display()))?;
        Ok(path)
    }
}

/// 保存先。環境変数で差し替えられるようにして、テストと開発を楽にする。
pub fn default_directory(app_config_dir: Option<PathBuf>) -> PathBuf {
    if let Some(directory) = std::env::var_os("VOLPUTAS_OVERLAY_PROFILES") {
        return PathBuf::from(directory);
    }
    app_config_dir
        .unwrap_or_else(|| PathBuf::from("."))
        .join(DIRECTORY)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_directory(name: &str) -> PathBuf {
        let directory = std::env::temp_dir().join(format!("volputas-overlay-{name}"));
        let _ = std::fs::remove_dir_all(&directory);
        directory
    }

    #[test]
    fn profiles_round_trip_through_the_store() {
        let store = ProfileStore::new(temp_directory("round-trip"));
        assert!(store.list().expect("empty listing").is_empty());
        let mut profile = OverlayProfile::fallback();
        profile.name = "konbini".into();
        profile.target = WindowTarget::by_process("KonbiniDominant.exe");
        store.save(&profile).expect("saves");
        assert_eq!(store.list().expect("lists"), vec!["konbini".to_string()]);
        let loaded = store.load("konbini").expect("loads");
        assert_eq!(loaded.target.process_name.as_deref(), Some("KonbiniDominant.exe"));
        assert!(loaded.click_through);
    }

    #[test]
    fn unsafe_profile_names_cannot_escape_the_directory() {
        let store = ProfileStore::new(temp_directory("unsafe"));
        assert!(store.load("../secrets").is_err());
        assert!(store.load(".hidden").is_err());
        assert!(!is_safe_profile_name("a/b"));
        assert!(is_safe_profile_name("konbini-01"));
        assert!(is_safe_profile_name("Konbini プレイ中"));
        assert!(!is_safe_profile_name("game:profile"));
    }

    #[test]
    fn native_fields_are_validated_before_the_profile_is_applied() {
        let mut profile = OverlayProfile::fallback();
        profile.schema_version = 2;
        assert!(profile.validate_native().is_err());

        profile.schema_version = 1;
        profile.placement.opacity = f64::NAN;
        assert!(profile.validate_native().is_err());

        profile.placement.opacity = 0.92;
        profile.target.title_pattern = Some("^(".into());
        assert!(profile.validate_native().is_err());
    }

    #[test]
    fn a_missing_profile_falls_back_instead_of_failing_startup() {
        let store = ProfileStore::new(temp_directory("fallback"));
        let profile = store.load_first().expect("missing profiles use the fallback");
        assert_eq!(profile.name, "default");
        assert!(profile.follow_z_order);
    }
}
