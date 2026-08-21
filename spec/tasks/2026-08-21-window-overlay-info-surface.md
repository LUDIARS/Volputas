---
task: window-overlay-info-surface
project: Voluptas
kind: 実装
created: 2026-08-21
memory_links: []
---
# 情報サーフェス (オーバーレイ表示のラッパー)

## 目的

`overlay` / `dock` / `detached` は「パネルをどこに置くか」の低レベル表現で、呼び出し側が
モード・アンカー・余白を毎回組み立てることになる。その 1 段上に **情報サーフェス
(info surface)** を足し、「対象のビュー領域のこの点に、この大きさで、この内容を出す」だけで
書けるようにする (`SPEC-WINDOW-OVERLAY-EXTENSION` 追補 (2026-08-21))。

サーフェスは**見せるだけの面**で、タップイベントは常に貫通する。操作を受ける面は従来どおり
パネルであり、この区別を壊すとゲーム中に入力を奪う経路が復活する。

## 完了条件

- `resolve_surface_rect(view, monitor, spec) -> Rect` が OS API・ウインドウハンドルに触れない
  純関数として存在し、(1) `at` からビュー領域内のアンカー点 → (2) `offset` を足す →
  (3) `align` (9 通り) で矩形を置く → (4) モニタへクランプ (モニタより大きければ縮める)
  の順で計算する。**フルスクリーンを特別扱いする分岐を持たない。**
- サーフェスは独立した透過ウインドウとして生成され、対象の矩形にクリップされず、
  追従は対象の外枠ではなく `viewRect` に対して行われる。
- `set_ignore_cursor_events(true)` を解除する経路が Rust 側にも WebView 側にも存在しない
  (グラブハンドル / hover での透過解除をサーフェスへ持ち込まない)。
- WebView から `attachInfo({ at, offset, size, align, content })` が呼べ、返り値の
  `update` / `close` でサーフェスを差し替え・破棄できる。
- `content` は `{ kind: 'markdown', source }` と `{ kind: 'chart', chart }` を受け、描画は
  既存の `MarkdownPanel` / `ChartPanel` / `renderChartFence` を再利用する
  (チャート・Markdown の描画実装を二重に持たない)。
- 単体テストが spec 追補 §テスト の 5 項目を固定している。
  - ビュー領域基準のアンカー 4 隅・中心 × `align` 9 通り
  - 対象の枠外へはみ出す `offset` が対象矩形にクリップされないこと
  - はみ出した先がモニタ外になる場合に引き戻されること (ビュー領域 = モニタ矩形でも同結果)
  - サーフェスがモニタより大きい場合にモニタへ収まるまで縮むこと
  - サーフェスが `ignore_cursor_events` を解除する経路を持たないこと

## スコープ (編集可ディレクトリ)

- `overlay-app/src-tauri/src/overlay/`
- `overlay-app/src-tauri/src/` (commands / main の配線)
- `overlay-app/src-tauri/capabilities/`
- `overlay-app/src/lib/`
- `overlay-app/src/panels/`
- `overlay-app/src/styles/`
