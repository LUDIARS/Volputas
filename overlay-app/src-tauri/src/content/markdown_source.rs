//! Markdown ソースの読み出しとファイル監視 (spec §Markdown)。
//!
//! `file` は `notify` で監視してライブリロードし、`inline` はそのまま、
//! `api` は local app から取る。読むのはユーザが指定した .md だけで、
//! 追従対象ウインドウの内容には一切触れない。
//! @implements SPEC-WINDOW-OVERLAY-EXTENSION
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::channel;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use notify::{Event, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use super::api_client::ApiClient;

pub const EVENT_MARKDOWN_CHANGED: &str = "overlay://markdown-changed";

/// 監視の取りこぼしより、まとめて 1 回配るのを優先する。
const DEBOUNCE: Duration = Duration::from_millis(150);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum MarkdownSource {
    File { path: String },
    Inline {
        #[serde(default)]
        markdown: String,
    },
    Api { path: String },
}

#[derive(Debug, Clone, Serialize)]
pub struct MarkdownDocument {
    pub markdown: String,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct MarkdownChanged {
    path: String,
}

pub async fn read(source: &MarkdownSource, api: &ApiClient) -> Result<MarkdownDocument, String> {
    match source {
        MarkdownSource::Inline { markdown } => {
            Ok(MarkdownDocument { markdown: markdown.clone(), path: None })
        }
        MarkdownSource::File { path } => {
            let file = PathBuf::from(path);
            if file.extension().and_then(|value| value.to_str()) != Some("md") {
                return Err("Markdown ソースは .md ファイルである必要があります".into());
            }
            let markdown = std::fs::read_to_string(&file)
                .map_err(|error| format!("{path} を読めません: {error}"))?;
            Ok(MarkdownDocument { markdown, path: Some(path.clone()) })
        }
        MarkdownSource::Api { path } => Ok(MarkdownDocument {
            markdown: api.read_markdown(path).await?,
            path: Some(path.clone()),
        }),
    }
}

/// 監視中のファイル。同じパスを二重に監視しない。
#[derive(Default)]
pub struct MarkdownWatcher {
    watchers: Mutex<HashMap<PathBuf, ActiveWatch>>,
}

struct ActiveWatch {
    // Drop すると notify 側の sender も閉じ、受信 thread が終了する。
    _watcher: notify::RecommendedWatcher,
    subscribers: usize,
}

impl MarkdownWatcher {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn watch(self: &Arc<Self>, app: AppHandle, path: &str) -> Result<(), String> {
        let file = PathBuf::from(path);
        let directory = file
            .parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| format!("{path} の親ディレクトリが分かりません"))?;
        let mut watchers = self.watchers.lock().map_err(|error| error.to_string())?;
        if let Some(active) = watchers.get_mut(&file) {
            active.subscribers += 1;
            return Ok(());
        }
        let (sender, receiver) = channel::<notify::Result<Event>>();
        let mut watcher = notify::recommended_watcher(sender)
            .map_err(|error| format!("ファイル監視を開始できません: {error}"))?;
        // ファイル単体の監視はエディタの置換 (rename) で外れるので、
        // 親ディレクトリを見て対象パスだけを拾う。
        watcher
            .watch(&directory, RecursiveMode::NonRecursive)
            .map_err(|error| format!("{} を監視できません: {error}", directory.display()))?;
        watchers.insert(file.clone(), ActiveWatch { _watcher: watcher, subscribers: 1 });

        let watched = file.clone();
        std::thread::spawn(move || {
            let mut last = std::time::Instant::now() - DEBOUNCE;
            for event in receiver {
                let Ok(event) = event else { continue };
                if !event.paths.iter().any(|path| path == &watched) {
                    continue;
                }
                if last.elapsed() < DEBOUNCE {
                    continue;
                }
                last = std::time::Instant::now();
                let _ = app.emit(
                    EVENT_MARKDOWN_CHANGED,
                    MarkdownChanged { path: watched.to_string_lossy().to_string() },
                );
            }
        });
        Ok(())
    }

    pub fn unwatch(&self, path: &str) -> Result<(), String> {
        let file = PathBuf::from(path);
        let mut watchers = self.watchers.lock().map_err(|error| error.to_string())?;
        let should_remove = match watchers.get_mut(&file) {
            Some(active) if active.subscribers > 1 => {
                active.subscribers -= 1;
                false
            }
            Some(_) => true,
            None => false,
        };
        if should_remove {
            watchers.remove(&file);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn an_inline_source_is_returned_as_is() {
        let api = ApiClient::with_base_url("http://127.0.0.1:0").expect("test URL is valid");
        let document = read(&MarkdownSource::Inline { markdown: "# 見出し".into() }, &api)
            .await
            .expect("inline reads");
        assert_eq!(document.markdown, "# 見出し");
        assert!(document.path.is_none());
    }

    #[tokio::test]
    async fn a_non_markdown_file_is_refused() {
        let api = ApiClient::with_base_url("http://127.0.0.1:0").expect("test URL is valid");
        let error = read(&MarkdownSource::File { path: "C:/tmp/secrets.txt".into() }, &api)
            .await
            .expect_err("only .md is allowed");
        assert!(error.contains(".md"));
    }

    #[test]
    fn the_source_shape_matches_the_profile_json() {
        let parsed: MarkdownSource =
            serde_json::from_str(r#"{"kind":"file","path":"E:/docs/checklist.md"}"#)
                .expect("file source parses");
        assert!(matches!(parsed, MarkdownSource::File { .. }));
        let api: MarkdownSource =
            serde_json::from_str(r#"{"kind":"api","path":"/api/local/overlay/markdown/x.md"}"#)
                .expect("api source parses");
        assert!(matches!(api, MarkdownSource::Api { .. }));
    }
}
