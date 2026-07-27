---
type: interface
title: "Local survey Git workflow"
description: "独立VolputasData cloneの取得、identity検証、atomic local write、lockのinterface contract。"
service: volputas
domain: persistence
tags:
  - git
  - github-cli
  - clone
  - concurrency
  - privacy
status: implemented
related:
  - ../plan/local-okf-survey-data.md
  - ../feature/local-okf-survey.md
  - ../setup/local-okf-survey.md
  - ../test/local-okf-survey.md
  - ../data/data-schema.md
updated: 2026-07-28
---

# Local survey Git workflow

## Clone interface

`npm run setup:survey-data`は次の契約を持つ。

1. `https://github.com/LUDIARS/VolputasData.git`の`main`を
   `player-profile-server/private/survey-data`へ独立cloneする。
2. 取得先が存在しない場合だけdirectoryを作る。
3. 取得先が存在する場合はGit top-levelと`origin`を検証する。
4. 別repository、入れ子repository、不正remoteならfail-fastする。
5. credentialをURL、stdout、stderrへ含めない。

## Repository interface

local survey実行時はGitHub APIでcanonical repository名とpublic visibilityを確認し、
cloneのfetch/push URLがcanonical URLと一致することを検証する。remote URLが異なる場合は
自動修正せず停止する。

## Local write interface

- writerはrepository rootから解決したallowlist pathだけへ書く。
- directory traversal、symlink escape、別Git rootへの書き込みを拒否する。
- temporary fileは対象directory内へmode `0600`で作り、write成功後にrenameする。
- lock取得者が正常・異常の全経路でlockを解放する。
- 個人回答のremote commit/pushは常に禁止する。
- `--save-only`は互換フラグであり、省略時もlocal-onlyで動作する。

## Failure contract

設定不備、Git不在、remote不一致、public repository検証失敗、dirty path衝突、
atomic write失敗は明示エラーにする。回答値、入力ファイル名、tokenをエラーへ含めない。
