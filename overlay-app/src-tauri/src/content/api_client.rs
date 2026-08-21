//! Volputas local app (127.0.0.1) のクライアント (spec §配置 api_client.rs)。
//!
//! HTTP は Rust 側だけが話す。WebView から直接叩かないので、local app に
//! CORS を足す必要がなく、127.0.0.1 バインドの既存境界をそのまま使える。
//! @implements SPEC-WINDOW-OVERLAY-EXTENSION
use serde::{Deserialize, Serialize};
use serde_json::Value;

const LOCAL_URL_ENVIRONMENT: &str = "VOLPUTAS_LOCAL_URL";
const OVERLAY_API_PREFIX: &str = "/api/local/overlay/";
const OVERLAY_STATUS_PATH: &str = "/api/local/overlay/status";
const MARKER_PATH: &str = "/api/local/capture-sessions/active/markers";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaptureSessionSummary {
    pub id: String,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(rename = "startedAt")]
    pub started_at: String,
}

/// マーカーパネルが見る状態。local app が落ちていれば `reachable: false`。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalStatus {
    pub reachable: bool,
    #[serde(rename = "captureSession")]
    pub capture_session: Option<CaptureSessionSummary>,
}

impl LocalStatus {
    pub fn unreachable() -> Self {
        Self { reachable: false, capture_session: None }
    }
}

/// 投下するマーカー。`origin` は local app 側が "desktop" を付ける
/// (ルータが origin を決める契約なので、こちらからは送らない)。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarkerInput {
    #[serde(rename = "type")]
    pub marker_type: String,
    #[serde(default)]
    pub label: String,
    #[serde(rename = "sessionMs")]
    pub session_ms: i64,
}

pub struct ApiClient {
    base_url: String,
    http: reqwest::Client,
}

impl ApiClient {
    /// 接続先は Excubitor / ProcessMap から環境変数で注入する。固定ポートへ
    /// 黙って接続すると別サービスを誤認するため、未設定は起動時に失敗させる。
    pub fn from_environment() -> Result<Self, String> {
        let base_url = std::env::var(LOCAL_URL_ENVIRONMENT)
            .map_err(|_| format!("{LOCAL_URL_ENVIRONMENT} must be set by Excubitor"))?;
        Self::with_base_url(&base_url)
    }

    pub(crate) fn with_base_url(base_url: &str) -> Result<Self, String> {
        let parsed = reqwest::Url::parse(base_url)
            .map_err(|error| format!("{LOCAL_URL_ENVIRONMENT} is not a URL: {error}"))?;
        let host = parsed.host_str().unwrap_or_default();
        if parsed.scheme() != "http"
            || !matches!(host, "127.0.0.1" | "::1")
            || parsed.port().is_none()
            || !parsed.username().is_empty()
            || parsed.password().is_some()
            || (parsed.path() != "/" && !parsed.path().is_empty())
            || parsed.query().is_some()
            || parsed.fragment().is_some()
        {
            return Err(format!(
                "{LOCAL_URL_ENVIRONMENT} must be an http loopback origin with an explicit port"
            ));
        }
        Ok(Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(5))
                .build()
                .map_err(|error| format!("http client could not be created: {error}"))?,
        })
    }

    fn url(&self, path: &str) -> String {
        if path.starts_with('/') {
            format!("{}{}", self.base_url, path)
        } else {
            format!("{}/{}", self.base_url, path)
        }
    }

    /// `{ ok, data }` 封筒を剥がして data だけ返す。
    async fn get_data(&self, path: &str) -> Result<Value, String> {
        if !is_overlay_api_path(path) {
            return Err(format!("overlay API path is not allowed: {path}"));
        }
        let response = self
            .http
            .get(self.url(path))
            .send()
            .await
            .map_err(|error| format!("local app へ届きません: {error}"))?;
        let status = response.status();
        let body: Value = response
            .json()
            .await
            .map_err(|error| format!("local app の応答が JSON ではありません: {error}"))?;
        if !status.is_success() {
            let code = body
                .pointer("/error/code")
                .and_then(Value::as_str)
                .unwrap_or("LOCAL_APP_ERROR");
            return Err(format!("{code} ({status})"));
        }
        Ok(body.get("data").cloned().unwrap_or(body))
    }

    pub async fn overlay_status(&self) -> LocalStatus {
        match self.get_data(OVERLAY_STATUS_PATH).await {
            Ok(data) => {
                let capture_session = match serde_json::from_value(
                    data.get("captureSession").cloned().unwrap_or(Value::Null),
                ) {
                    Ok(value) => value,
                    Err(_) => return LocalStatus::unreachable(),
                };
                LocalStatus { reachable: true, capture_session }
            }
            Err(_) => LocalStatus::unreachable(),
        }
    }

    pub async fn read_json(&self, path: &str) -> Result<Value, String> {
        self.get_data(path).await
    }

    pub async fn read_markdown(&self, path: &str) -> Result<String, String> {
        let data = self.get_data(path).await?;
        data
            .get("markdown")
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| "local app markdown response has no markdown string".to_string())
    }

    /// 感想マーカーの投下。アクティブなセッションが無ければ local app は
    /// 409 NO_ACTIVE_SESSION を返すので、呼び出し側がバッファへ戻す。
    pub async fn post_marker(&self, marker: &MarkerInput) -> Result<Value, String> {
        let response = self
            .http
            .post(self.url(MARKER_PATH))
            .json(marker)
            .send()
            .await
            .map_err(|error| format!("local app へ届きません: {error}"))?;
        let status = response.status();
        let body: Value = response.json().await.unwrap_or(Value::Null);
        if !status.is_success() {
            let code = body
                .pointer("/error/code")
                .and_then(Value::as_str)
                .unwrap_or("MARKER_POST_FAILED");
            return Err(code.to_string());
        }
        Ok(body.get("data").cloned().unwrap_or(body))
    }
}

fn is_overlay_api_path(path: &str) -> bool {
    path.starts_with(OVERLAY_API_PREFIX)
        && path.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'.' | b'-' | b'_')
        })
        && !path.split('/').any(|segment| matches!(segment, "." | ".."))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls_are_built_against_an_injected_loopback_base() {
        let client = ApiClient::with_base_url("http://127.0.0.1:0").expect("test URL is valid");
        assert!(client.url("/api/local/overlay/status").starts_with("http://127.0.0.1"));
        assert!(client.url("api/x").contains("/api/x"));
    }

    #[test]
    fn only_the_overlay_get_namespace_is_allowed() {
        assert!(is_overlay_api_path("/api/local/overlay/status"));
        assert!(is_overlay_api_path("/api/local/overlay/markdown/checklist.md"));
        assert!(!is_overlay_api_path("/api/v1/users/me/profile"));
        assert!(!is_overlay_api_path("/api/local/overlay/../users"));
        assert!(!is_overlay_api_path("/api/local/overlay/%2e%2e/users"));
        assert!(!is_overlay_api_path("https://example.test/data"));
    }

    #[test]
    fn a_non_loopback_base_is_refused() {
        assert!(ApiClient::with_base_url("https://example.test:443").is_err());
        assert!(ApiClient::with_base_url("http://127.0.0.1").is_err());
        assert!(ApiClient::with_base_url("http://user:secret@127.0.0.1:1234").is_err());
    }

    #[test]
    fn an_unreachable_local_app_is_a_state_not_an_error() {
        let status = LocalStatus::unreachable();
        assert!(!status.reachable);
        assert!(status.capture_session.is_none());
    }
}
