---
id: SPEC-LOCAL-DATA-REPOSITORY-VISIBILITY
type: interface
title: "Local data repository visibility guard"
description: "企業ごとのデータリポジトリをowner/repoへ解決し、local desktop appの設定保存時と各local API処理開始前にprivate visibilityを検証するinterface contract。"
service: volputas
domain: persistence
tags:
  - git
  - github-cli
  - privacy
  - fail-fast
  - local-first
status: implemented
related:
  - ./local-survey-git-workflow.md
  - ../data/data-schema.md
  - ../setup/local-okf-survey.md
  - ../test/local-okf-survey.md
updated: 2026-08-02
---

# Local data repository visibility guard

Volputasは特定のデータリポジトリを既定値として持たない。企業は自社が用意した任意の
GitHubリポジトリをLocal Settingsで指定する。そのリポジトリは実データ (evidence、
persona、アンケート回答) を保持するため**private**でなければならない。この文書は
その検証を担うinterfaceの契約を定める。

## Remote identification interface

`src/local/gitAuthorReader.js`

- `parseGithubOwnerRepo(remoteUrl)` はremote URLの3形式 (`git@github.com:owner/repo`、
  `ssh://git@github.com/owner/repo`、`https://github.com/owner/repo`。`.git`接尾辞は
  任意) から`owner/repo`を返す。
- 受理するsegmentの文字種はGitHub自身の名前空間 (`[A-Za-z0-9_.-]`) だけとする。
  抽出結果は`gh api repos/<owner>/<repo>`のpathへ補間されるため、`/`・escape・
  空白などpathを別リソースへ向け替え得る文字は解析を通過させない。
- `.`・`..`は上の文字種を通るがAPI pathを別リソースへ向け替えるため拒否する。
- 解析できないremoteは`code: 'GITHUB_REMOTE_REQUIRED'`のエラーを投げる。
- `isGitHubRemote(value)` は`parseGithubOwnerRepo`の成否そのものとする。「受理できる
  remoteか」と「visibilityを検証できるremoteか」は同じ問いであり、二つの判定が
  drift しないよう実装を分けない。

## Visibility verification interface

`src/local/dataRepositoryVisibility.js`

- `DataRepositoryVisibilityChecker#assertPrivate(ownerRepo)` は`gh api repos/<owner>/<repo>`
  を`--jq '{fullName: .full_name, private: .private, visibility: .visibility}'`で呼ぶ。
- `fullName`が要求した`owner/repo`と (大文字小文字を無視して) 一致し、かつ
  `private === true`と`visibility === 'private'`の両方が成立する場合だけ成功とする。
  `internal`はenterprise全体から見えるため回答者が同意した範囲ではなく、
  `private: true`を返しても拒否する。
- 失敗は`DataRepositoryVisibilityError` (`code: 'DATA_REPOSITORY_NOT_PRIVATE'`、
  `statusCode: 422`) とする。`gh`の生出力・credentialをmessageへ含めない。
- 検証結果は`VERIFICATION_TTL_MS` (5分) だけ再利用する。desktop appは数日開いたまま
  になり得るため、プロセス実行中ずっとキャッシュはしない。失敗結果はキャッシュせず、
  リポジトリや`gh`認証を直した次の要求で再試行できるようにする。

## Route enforcement interface

`src/local/localRoutes.js` / `src/local/localContext.js`

- `PUT /api/local/config` は設定を書き込む**前**に検証する。public/internalなリポジトリを
  「設定済み」として保存しない。
- `configuredContext()` は全てのlocal routeが読み書きを始める前に通過する唯一の
  choke pointであり、ここでも検証する。保存後にpublicへ変わった場合も以降の処理を
  fail-fastで拒否する。
- capture / narrative / game-insight / overlayも同じ`createConfiguredContext()`と
  visibility checkerを使用し、企業の設定済みoriginから毎回検証対象を解決する。
- `GET /api/local/config` は検証失敗を`configurationError`として返し、frontendは
  それを未設定として扱う (`LocalLayout.jsx`)。

## Presentation contract

`frontend/src/pages/LocalSettingsPage.jsx` / `desktop/main.js`

- Local Settingsは、データリポジトリが「Volputasが指定する特定のリポジトリ」ではなく
  「自社が用意した任意のGitHubリポジトリ」であることを明示する。製品名 (`VolputasData`)
  を見出し・placeholder・ディレクトリ選択dialogのタイトルへ既定値として出さない。
- 保存前にprivate visibilityを検証し、public/internalは保存できないことを入力欄の近くで
  述べる。422を受け取ってから初めて知る、という導線にしない。
- `GET /api/local/config`の`configurationError`はそのまま表示する。この文言が
  「なぜ設定済みなのに使えないのか」の唯一の説明になる。

## Out of scope

local OKF survey CLI側の検証は`src/localSurvey/githubRepositoryVisibility.js`が担い、
契約は[local-survey-git-workflow.md](./local-survey-git-workflow.md)に定める。
setup samples (`desktop/setup-samples/*`) は同じ基準をsetup時にも適用するが、appは
scriptが実行されたことを前提にせず独立に検証する。
