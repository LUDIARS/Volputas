---
task: company-data-repo-runtime-verification
project: Voluptas
kind: テスト
created: 2026-08-11
memory_links: []
---
# 会社データリポジトリの実機 runtime verification を行う

## 目的

Revisor local PR #143 (`feat/company-data-repo`) は対象ドメインの定義不足を解消した後も、
変更面積と runtime entrypoint を理由に `runtimeVerification.required=true` となる見込みである。
実機のローカルデスクトップ環境で、会社データリポジトリと UI の連携が既存の保存・表示経路を
壊していないことを確認する。

## 完了条件

- [ ] 専用の検証環境でアプリを起動し、会社データの保存・再読込・画面表示を確認する
- [ ] 異常な保存データまたは欠損データを扱った際に、既存データを破壊せず失敗を表示することを確認する
- [ ] Revisor の runtime verification 要求に対する確認結果を記録し、既存PR #143 の再審査へ反映する

## スコープ (編集可ディレクトリ)

コード編集なし。実機確認と Revisor local PR #143 の再審査結果の記録のみを対象とする。
