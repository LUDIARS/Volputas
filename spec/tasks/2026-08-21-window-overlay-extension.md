# Vo ウインドウ表示拡張ツール (Tauri v2)

正本 spec: `player-profile-server/spec/feature/window-overlay-extension.md` (`SPEC-WINDOW-OVERLAY-EXTENSION`)
Anatomia domain: `spec/domains/window-overlay-extension.domain.json`
branch: `feat/window-overlay-extension`

前身の感情キャプチャ・コンパニオン (`SPEC-EMOTION-CAPTURE-COMPANION`) の「プレイ中に画面の脇で
使う部分」を、任意アプリのウインドウに追従する汎用オーバーレイへ一般化する。段階リリースはせず
フルセットで配線する (`/full-set-implementation`)。

## T1. チャート共有パッケージの切り出し
- `packages/charts` を新設し、`HotspotChart` / `NarrativeArcChart` / `TrendChart` / `RadarChart` を移す。
- 既存 `player-profile-server/frontend` の import を張り替える。チャート実装を二重に持たない。
- 既存フロントテストが緑のままであること。

## T2. Tauri v2 スキャフォールド
- `overlay-app/` に Tauri v2 + React 19 + Vite を立てる。`npm run tauri dev` / `build` が通る。
- WebView の遷移禁止・外部リンクは既定ブラウザ、CSP を本体シェルと同等に締める。

## T3. ウインドウ追従 (Rust)
- `WindowTracker` trait + `tracker_windows` (Win32 / `SetWinEventHook`) / `tracker_macos`
  (Accessibility) / `tracker_x11` / `tracker_manual` (Wayland fallback)。
- `overlay:list_windows`、ピックモード、`WindowTarget` の永続化と再バインド。
- 可視 → 最小化 → 復帰 → 破棄 の状態遷移、`followZOrder`、`target-lost` イベント。
- `placement.rs`: overlay 9 アンカー / dock 4 辺 / detached、マルチモニタ座標。単体テスト必須。

## T4. クリック透過と操作境界
- 既定 `set_ignore_cursor_events(true)`。ホットキーまたはグラブハンドルの hover でのみ解除。
- 操作可能状態を枠のハイライトで明示する。

## T5. Markdown パネル
- `react-markdown` + `remark-gfm`。生 HTML 不許可 (`rehype-raw` を入れない)。
- ソース 3 種 (`file` は `notify` でライブリロード / `inline` / `api`)。

## T6. グラフフェンス
- ```chart フェンスを `renderChartFence` で T1 のコンポーネントへ振り分ける。
- `source`: inline / api / file。```mermaid も受ける。
- 未知 type・スキーマ不一致はパネルを壊さずエラーカード。

## T7. 感想マーカー
- グローバルホットキー (既定 `Ctrl+Alt+1..4`)、コメントは `Ctrl+Alt+Enter`。
- `POST /api/local/capture-sessions/active/markers` (ルータが `origin: "desktop"` を付ける)。
- セッション未開始時はローカルバッファ → 開始時に `sessionMs` へ載せ替え。取りこぼさない。
- local app 未起動時は無効表示 (無言で捨てない)。

## T8. プロファイル設定
- `overlay-profiles/<name>.json` の読み書き、プロファイル切替 UI。

## T9. local API 追加
- `player-profile-server/src/local/overlayRoutes.js` — オーバーレイが読むグラフデータと
  Markdown の提供。127.0.0.1 バインドの既存境界を変えない。

## T10. 検証
- CI で Rust / WebView / フロントの単体テストとネイティブ `cargo check`、
  `git diff | anatomia verify --project voluptas`。
- 実機: Windows でゲームウインドウ追従・クリック透過・ホットキー競合時の復元。
  macOS は Accessibility 許諾、Wayland は初回表示・手動移動を確認する。
