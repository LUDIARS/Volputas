//! 追従対象ウインドウの identity (spec §対象の選択)。
//!
//! OS ハンドルは再起動をまたげないので、永続化するのは
//! `{ processName, titlePattern }` のペアだけ。起動時はこの条件で再バインドする。
//! @implements SPEC-WINDOW-OVERLAY-EXTENSION
use regex::Regex;
use serde::{Deserialize, Serialize};

use super::placement::Rect;

/// 列挙で返す可視トップレベルウインドウ。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WindowInfo {
    pub id: u64,
    pub title: String,
    #[serde(rename = "processName")]
    pub process_name: String,
    pub rect: Rect,
    /// タイトルバー・境界・メニューバーを除いたクライアント領域 (spec §ビュー領域の取得)。
    /// 外枠 `rect` は dock 配置の基準として残す。情報サーフェスはこちらを基準にする。
    #[serde(rename = "viewRect")]
    pub view_rect: Rect,
    #[serde(rename = "isMinimized")]
    pub is_minimized: bool,
}

/// プロファイルに保存される追従条件。
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct WindowTarget {
    #[serde(rename = "processName", default)]
    pub process_name: Option<String>,
    #[serde(rename = "titlePattern", default)]
    pub title_pattern: Option<String>,
}

impl WindowTarget {
    #[cfg_attr(target_os = "windows", allow(dead_code))]
    pub fn by_process(process_name: &str) -> Self {
        Self { process_name: Some(process_name.to_string()), title_pattern: None }
    }

    /// 条件が 1 つも無い target は「何にも当たらない」扱いにする。
    /// 全ウインドウへ勝手に吸い付くより、未接続を出す方が事故が少ない。
    pub fn is_empty(&self) -> bool {
        self.process_name.as_deref().unwrap_or("").is_empty()
            && self.title_pattern.as_deref().unwrap_or("").is_empty()
    }

    pub fn matches(&self, info: &WindowInfo) -> bool {
        if self.is_empty() {
            return false;
        }
        if let Some(process_name) = self.process_name.as_deref().filter(|name| !name.is_empty()) {
            if !process_name.eq_ignore_ascii_case(&info.process_name) {
                return false;
            }
        }
        if let Some(pattern) = self.title_pattern.as_deref().filter(|value| !value.is_empty()) {
            // 不正な正規表現で追従が固まらないよう、コンパイル失敗は不一致に倒す。
            match Regex::new(pattern) {
                Ok(regex) => {
                    if !regex.is_match(&info.title) {
                        return false;
                    }
                }
                Err(_) => return false,
            }
        }
        true
    }

    /// 条件に合う最初のウインドウ。最小化中のものは後回しにして、
    /// 同じアプリの生きているウインドウを優先する。
    pub fn resolve<'a>(&self, windows: &'a [WindowInfo]) -> Option<&'a WindowInfo> {
        let mut minimized: Option<&WindowInfo> = None;
        for window in windows.iter().filter(|window| self.matches(window)) {
            if !window.is_minimized {
                return Some(window);
            }
            minimized.get_or_insert(window);
        }
        minimized
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn window(id: u64, title: &str, process_name: &str, minimized: bool) -> WindowInfo {
        WindowInfo {
            id,
            title: title.to_string(),
            process_name: process_name.to_string(),
            rect: Rect::new(0, 0, 800, 600),
            view_rect: Rect::new(8, 30, 784, 562),
            is_minimized: minimized,
        }
    }

    #[test]
    fn a_target_matches_on_process_and_title_pattern() {
        let target = WindowTarget {
            process_name: Some("KonbiniDominant.exe".into()),
            title_pattern: Some("^Konbini".into()),
        };
        assert!(target.matches(&window(1, "Konbini Dominant", "konbinidominant.exe", false)));
        assert!(!target.matches(&window(2, "Other", "konbinidominant.exe", false)));
        assert!(!target.matches(&window(3, "Konbini Dominant", "notepad.exe", false)));
    }

    #[test]
    fn an_empty_target_never_binds() {
        assert!(WindowTarget::default().is_empty());
        assert!(!WindowTarget::default().matches(&window(1, "x", "x.exe", false)));
    }

    #[test]
    fn a_broken_title_regex_does_not_match_instead_of_panicking() {
        let target = WindowTarget { process_name: None, title_pattern: Some("^(".into()) };
        assert!(!target.matches(&window(1, "anything", "game.exe", false)));
    }

    #[test]
    fn resolve_prefers_a_live_window_over_a_minimized_one() {
        let target = WindowTarget::by_process("game.exe");
        let windows = vec![
            window(1, "Game (minimized)", "game.exe", true),
            window(2, "Game", "game.exe", false),
        ];
        assert_eq!(target.resolve(&windows).map(|window| window.id), Some(2));
        assert_eq!(target.resolve(&windows[..1]).map(|window| window.id), Some(1));
        assert!(target.resolve(&[]).is_none());
    }
}
