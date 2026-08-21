---
task: window-overlay-view-rect
project: Voluptas
kind: 実装
created: 2026-08-21
memory_links: []
---
# ウインドウ追従にビュー領域 (viewRect) を足す

## 目的

オーバーレイの追従はこれまで対象ウインドウの外枠 (`rect`) だけを見ていた。外枠基準では
タイトルバー・境界・メニューバーの厚みが OS・テーマ・DPI で数十 px 変わるため、
「ゲーム画面内のこの地点」を指せない。情報サーフェス
(`SPEC-WINDOW-OVERLAY-EXTENSION` 追補) はビュー領域 (クライアント領域) を基準にする
必要があるので、その土台として `WindowInfo` にビュー領域を追加する。

dock 配置は外枠基準のままが正しいため、`rect` は残して 2 本立てにする。

## 完了条件

- `WindowInfo` が外枠 `rect` と `viewRect` の両方を持ち、`TrackerSession` /
  `TrackerSnapshot` からビュー領域を参照できる。
- OS 別の取得が spec 追補 §ビュー領域の取得 のとおりに実装されている。
  - Windows: `GetClientRect` + `ClientToScreen` でスクリーン座標へ。
  - macOS: content view frame。取れなければ外枠からタイトルバー高さを引く。
  - Linux (X11): inner geometry をビュー領域とし、外枠は `_NET_FRAME_EXTENTS` から復元する。
  - 手動配置 (Wayland fallback): ビュー領域を知る手段が無いので外枠と同一。
- 外枠 → ビュー領域の差し引きが OS API に触れない純関数として切り出され、単体テストがある。
- 既存の追従状態遷移テスト (可視 → 最小化 → 復帰 → 破棄) が緑のまま。

## スコープ (編集可ディレクトリ)

- `overlay-app/src-tauri/src/overlay/`
