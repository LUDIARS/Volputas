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

- canonical owner/nameとprivate visibilityだけを受理する。
- public、internal、別repository、API失敗、不正JSONを拒否する。
- APIの生出力やcredentialをエラーへ含めない。

## Publish workflow

- `--save-only`指定時はoffline preparationを使い、`git push`を呼ばない。
- 省略時は本人branchへpushし、stage対象がdefinitionと当該responseだけであることを確認する。
- `allowRemotePublish`未設定のconfigではpushせず`REMOTE_PUBLICATION_DISABLED`で失敗する。
- non-fast-forwardをforceしない。

## Filesystem safety

- definition/responseはallowlist pathだけへatomic writeする。
- traversal、symlink escape、別Git rootを拒否する。
- temporary fileとlockを成功・失敗の全経路で解放する。
- 回答値、token、入力ファイル名をログへ出さない。
