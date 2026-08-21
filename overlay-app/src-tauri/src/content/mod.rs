//! オーバーレイに載せる表示コンテンツ (spec §表示コンテンツ)。
//!
//! Markdown はファイル / インライン / local API、グラフのデータは local API。
//! 外に出る通信はここと api_client.rs に限る。
//! @implements SPEC-WINDOW-OVERLAY-EXTENSION
pub mod api_client;
pub mod markdown_source;
