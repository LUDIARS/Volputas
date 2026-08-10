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
  - ./build-test.md
updated: 2026-07-31
---

# Local survey setup

## データリポジトリの位置づけ

`LUDIARS/VolputasData` は **public な template** で、アンケート定義と匿名サンプルの配布元。
実運用では template をコピーした**自分の private データリポジトリ**を作り、回答はそこへ push する
(private visibility guard はこのコピーに対して働く。template 自体は public のままでよい)。

```bash
# 例: template から private データリポジトリを作る
gh repo create <owner>/<your-volputas-data> --private --template LUDIARS/VolputasData
```

作成したら `player-profile-server/config/local-survey.json` の
`dataRepository.githubRepository` を `<owner>/<your-volputas-data>` に変更する。

## Prerequisites

- Node.js 22以上
- Git
- GitHub CLI (`gh`)
- 上記で作成した private データリポジトリへのread/write権限

## Setup

Volputas repository rootで実行する。

```bash
gh auth login
npm --prefix player-profile-server run setup:survey-data
```

scriptは`config/local-survey.json`が指すデータリポジトリの`main`を
`player-profile-server/private/survey-data`へcloneする。submodule登録や親gitlink更新は
行わない。

## Verification

```bash
git -C player-profile-server/private/survey-data rev-parse --show-toplevel
git -C player-profile-server/private/survey-data remote get-url origin
git -C player-profile-server/private/survey-data status --short --branch
```

originは`config/local-survey.json`の`dataRepository.githubRepository`と同じ
リポジトリを指す必要がある。credentialをremote URLへ埋め込まない。

データリポジトリのvisibilityがprivateであることも確認する。回答は本人branchへpushされるため、
public/internalなrepositoryではCLIが設問を出す前に停止する。

```bash
gh repo view <owner>/<your-volputas-data> --json visibility --jq .visibility
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
