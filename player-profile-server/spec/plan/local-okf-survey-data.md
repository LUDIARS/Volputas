---
type: plan
title: "Local-only survey data architecture"
description: "公開定義リポジトリを独立cloneし、個人回答をremoteへ公開せずローカル保存する設計宣言。"
service: volputas
domain: persistence
tags:
  - local-first
  - survey
  - git-clone
  - privacy
status: implemented
related:
  - ../feature/local-okf-survey.md
  - ../interface/local-survey-git-workflow.md
  - ../setup/local-okf-survey.md
  - ../test/local-okf-survey.md
  - ../data/data-schema.md
updated: 2026-07-28
---

# Local-only survey data architecture

## 設計宣言

Volputasのローカルアンケートは、HTTP server、JWT、PostgreSQLを必要としない。
公開定義と匿名サンプルの正本は独立リポジトリ`LUDIARS/VolputasData`とする。
Volputas本体はこのリポジトリをsubmoduleにせず、明示的なsetup scriptで
`player-profile-server/private/survey-data`へcloneする。

## データ境界

- 公開可能: versioned survey definitions、合成・匿名サンプル、公開ポリシー。
- ローカル限定: 回答、プレイ記録、感想、感情曲線、media、persona分析。
- 禁止: token、email、OAuth payload、raw profile、識別可能な個人データのcommit。

独立cloneとその全内容は親Volputasの`.gitignore`対象とする。データリポジトリ側も
local-only pathをignoreし、二重の誤stage防止境界を持つ。

## Git契約

- setup scriptはcanonical URLからmainをsingle-branch cloneする。
- 取得先が既に存在するときは、同じrepositoryのrootである場合だけ再利用する。
- 別repositoryや親repository内の通常directoryを黙って上書きしない。
- ローカルアンケート処理はremote commit/pushを実行しない。
- 個人データを共有する別repository運用は、この既定契約の外で個別設計する。

## 移行

旧`Voluptas-Data`のmain履歴と非個人データは`VolputasData`へmergeする。
旧repositoryはprivateのままarchiveし、回答branchや個人回答は移行対象にしない。
