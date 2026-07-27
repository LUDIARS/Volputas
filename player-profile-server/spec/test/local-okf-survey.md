---
type: test
title: "Local survey test plan"
description: "独立clone、repository identity、atomic local write、lock、privacyを検証する。"
service: volputas
domain: tooling
tags:
  - test
  - git
  - github-cli
  - concurrency
  - privacy
status: implemented
related:
  - ../plan/local-okf-survey-data.md
  - ../feature/local-okf-survey.md
  - ../interface/local-survey-git-workflow.md
  - ../setup/local-okf-survey.md
  - ../data/data-schema.md
updated: 2026-07-28
---

# Local survey test plan

## Clone setup

- target不存在時にcanonical `VolputasData/main`をsingle-branch cloneする。
- 正しい既存cloneは再利用し、内容を削除・上書きしない。
- 別repository、入れ子repository、remote不一致はfail-fastする。
- 親Volputasのstatusへclone内容が現れない。

## Repository validation

- canonical owner/nameとpublic visibilityだけを受理する。
- private、別repository、API失敗、不正JSONを拒否する。
- APIの生出力やcredentialをエラーへ含めない。

## Local-only workflow

- 引数省略時もoffline preparationを使う。
- `--save-only`指定時も同じlocal-only結果になる。
- remote publication要求は明示的に拒否する。
- `git push`を呼ばない。

## Filesystem safety

- definition/responseはallowlist pathだけへatomic writeする。
- traversal、symlink escape、別Git rootを拒否する。
- temporary fileとlockを成功・失敗の全経路で解放する。
- 回答値、token、入力ファイル名をログへ出さない。
