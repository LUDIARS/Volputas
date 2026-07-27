---
type: setup
title: "Local survey setup"
description: "独立VolputasData clone、GitHub CLI identity、non-secret configを準備する手順。"
service: volputas
domain: tooling
tags:
  - setup
  - github-cli
  - git-clone
  - private-repository
status: implemented
related:
  - ../plan/local-okf-survey-data.md
  - ../feature/local-okf-survey.md
  - ../interface/local-survey-git-workflow.md
  - ../test/local-okf-survey.md
updated: 2026-07-28
---

# Local survey setup

## Prerequisites

- Node.js 20以上
- Git
- GitHub CLI (`gh`)
- private repository `LUDIARS/VolputasData` へのread/write権限

## Setup

Volputas repository rootで実行する。

```bash
gh auth login
npm --prefix player-profile-server run setup:survey-data
```

scriptは`LUDIARS/VolputasData`の`main`を
`player-profile-server/private/survey-data`へcloneする。submodule登録や親gitlink更新は
行わない。

## Verification

```bash
git -C player-profile-server/private/survey-data rev-parse --show-toplevel
git -C player-profile-server/private/survey-data remote get-url origin
git -C player-profile-server/private/survey-data status --short --branch
```

originは`https://github.com/LUDIARS/VolputasData.git`を指す必要がある。credentialを
remote URLへ埋め込まない。

visibilityがprivateであることも確認する。回答は本人branchへpushされるため、
public/internalなrepositoryではCLIが設問を出す前に停止する。

```bash
gh repo view LUDIARS/VolputasData --json visibility --jq .visibility
```

## Run

```bash
npm --prefix player-profile-server run survey:local
npm --prefix player-profile-server run survey:local -- --answers ./answers.json
```

既定では回答を本人branch `responses/github-<numeric-id>` へpushする。
`--save-only`を付けるとlocal本人branchへの保存で止め、commit/pushを行わない。

pushには`config/local-survey.json`の`dataRepository.allowRemotePublish`が`true`である
必要がある。この項目が無いconfigはpushせず`REMOTE_PUBLICATION_DISABLED`で失敗する
(push可否を暗黙に獲得させない)。

## Troubleshooting

| 症状 | 確認 | 対応 |
|---|---|---|
| clone先が競合する | targetのGit top-levelとorigin | 必要なデータを退避し、正しいcloneだけを置く |
| remote不一致 | `git remote get-url origin` | 自動上書きせず、利用者が正しいrepositoryを選ぶ |
| GitHub検証失敗 | `gh auth status`、repository visibility | 認証とcanonical repository名を確認する |
| dirty repository | `git status --short` | stash/reset/cleanを自動実行せず内容を確認する |
