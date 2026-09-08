---
id: SPEC-LOCAL-SURVEY-GIT-WORKFLOW
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
  - ./local-data-repository-visibility.md
updated: 2026-08-02
---

# Local survey Git workflow

## Clone interface

`npm run setup:survey-data`は次の契約を持つ。

1. `config/local-survey.json`の`dataRepository.expectedRemoteUrl`が指すリポジトリの
   `dataRepository.baseBranch`を`player-profile-server/private/survey-data`
   (`dataRepository.path`、`VOLPUTAS_SURVEY_DATA_DIR`で上書き可) へ独立cloneする。
   ハードコードされた既定リポジトリは持たない — 設定を自分の private コピーへ
   向け変えなければ、shipされた`LUDIARS/VolputasData`のまま次のvisibility検証で
   fail-fastする。
2. 取得先が存在しない場合だけdirectoryを作る。
3. 取得先が存在する場合はGit top-levelと`origin`を検証する。
4. 別repository、入れ子repository、不正remoteならfail-fastする。
5. clone確定後、GitHub APIでrepositoryの**private visibility**を検証する
   (下記Repository interfaceと同じ基準)。publicまたはinternalならこの時点で
   fail-fastし、後続のnpmスクリプトへ進めない。
6. Git実行ファイルは`commands.git`を使う。`survey:local`側 (`localSurveyWorkflow`、
   `gitSurveyPublisher`、`repositoryLock`) と同じ設定値を参照し、setupだけがPATHの
   `git`へfallbackすることはない。
7. credentialをURL、stdout、stderrへ含めない。

## Repository interface

`setup:survey-data`のclone直後、およびlocal survey実行時の両方でGitHub APIで
canonical repository名と**private visibility**を確認し、cloneのfetch/push URLが
canonical URLと一致することを検証する。remote URLが異なる場合は自動修正せず停止する。

visibilityは`private: true`と`visibility: "private"`の両方が成立することを要求する。
`internal`はenterprise全体から見えるため、回答者が同意した範囲ではない。
local survey実行時の検証は最初の設問を出す前に行う。回答が既にdiskへ存在する状態で
visibilityの誤りに気づくと、そのデータの扱いを事後に決めることになる。

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

CLI entry pointが出力する`[fatal] …`は1行に収める (`src/localSurvey/cliErrorMessage.js`の
`safeErrorMessage`)。改行を潰して長さを制限し、tool生出力でterminalを流さない。
エラーへremote URLを含める場合はuserinfo (`https://user:token@…`) を落としてから出す。
既存cloneのoriginはVolputas側の設定と違い任意の値を持ち得るため、そのまま出すと
tokenがstderrへ出る。
