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

local survey実行時はGitHub APIでcanonical repository名と**private visibility**を確認し、
cloneのfetch/push URLがcanonical URLと一致することを検証する。remote URLが異なる場合は
自動修正せず停止する。

visibilityは`private: true`と`visibility: "private"`の両方が成立することを要求する。
`internal`はenterprise全体から見えるため、回答者が同意した範囲ではない。
検証は最初の設問を出す前に行う。回答が既にdiskへ存在する状態でvisibilityの誤りに
気づくと、そのデータの扱いを事後に決めることになる。

## Local write interface

- writerはrepository rootから解決したallowlist pathだけへ書く。
- directory traversal、symlink escape、別Git rootへの書き込みを拒否する。
- temporary fileは対象directory内へmode `0600`で作り、write成功後にrenameする。
- lock取得者が正常・異常の全経路でlockを解放する。

## Publish interface

private運用が前提であり、本人の回答は本人branch `responses/github-<numeric-id>` へpushする。

- `--save-only`はlocal本人branchへ保存し、fetch/stage/commit/pushを省略する。
  省略時はpublishする。
- publishには`dataRepository.allowRemotePublish: true`が必要である。configが
  この項目を持たない場合はpushせず`REMOTE_PUBLICATION_DISABLED`で失敗する。
  push可否を暗黙に獲得させない。
- stage/commit対象はdefinitionと当該responseのexact pathだけとする。
- remoteをfast-forwardできない場合はforceせず停止する。
- `main`へ回答を書かない。commit messageに回答・login・自由記述を含めない。

## Failure contract

設定不備、Git不在、remote不一致、private repository検証失敗、remote publication未許可、
dirty path衝突、atomic write失敗は明示エラーにする。回答値、入力ファイル名、tokenを
エラーへ含めない。
