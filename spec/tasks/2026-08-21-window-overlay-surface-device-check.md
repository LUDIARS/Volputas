---
task: window-overlay-surface-device-check
project: Voluptas
kind: テスト
created: 2026-08-21
memory_links:
  - C:/Users/raury/.claude/projects/E--Document-Ars-Voluptas/memory/voluptas_worktree_bootstrap.md
---
# 情報サーフェスの実機確認 (Windows / macOS)

## 目的

情報サーフェスの矩形計算と不変条件は単体テストで固定したが、透過ウインドウの実表示・
クリック貫通・ビュー領域への追従は OS の実挙動に依存し、単体テストでは確かめられない。
特に macOS のビュー領域は Accessibility 権限と AXUIElement の対応付けが要るため、
実装はタイトルバー高さでの縮退を既定経路にしており、実機での目視確認が残っている。

## 完了条件

- Windows 実機で、ゲームウインドウ (ウインドウモードとフルスクリーンの両方) に対し
  サーフェスが以下を満たすことを確認した。
  - 対象のビュー領域を基準に追従し、外枠基準のずれが出ない。
  - 対象の枠外へはみ出す `offset` でも画面外へは出ない (モニタへ引き戻される)。
  - サーフェスの上をクリックしても対象アプリへ入力が貫通する。
- macOS 実機で、Accessibility 権限あり / なしの双方でビュー領域の基準点を確認し、
  タイトルバー高さの縮退が実用上ずれない値かを判断した。ずれるなら content view frame の
  取得方法を追補し直す。
- X11 で `_NET_FRAME_EXTENTS` を出さない WM のとき、外枠 = ビュー領域で破綻しないことを確認した。
- 確認結果 (特に macOS の縮退値の可否) を `SPEC-WINDOW-OVERLAY-EXTENSION` の追補へ反映した。

## スコープ (編集可ディレクトリ)

- `overlay-app/src-tauri/src/overlay/`
- `player-profile-server/spec/feature/`
