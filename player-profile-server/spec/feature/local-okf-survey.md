---
type: feature
title: "Local survey"
description: "アンケート定義を独立cloneし、本人回答をprivate data repositoryの本人branchへ保存・publishする機能。"
service: volputas
domain: survey
tags:
  - cli
  - local-first
  - github-identity
  - privacy
status: implemented
related:
  - ./gamer-survey-suite.md
  - ../plan/local-okf-survey-data.md
  - ../interface/local-survey-git-workflow.md
  - ../setup/local-okf-survey.md
  - ../test/local-okf-survey.md
  - ../data/data-schema.md
updated: 2026-07-28
---

# Local survey

## User story

利用者として、Volputas serverやPostgreSQLを起動せずにアンケートへ回答し、
回答を自分だけがアクセスできる場所へ残したい。

## Preconditions

- Node.js 20以上、Git、GitHub CLIが利用できる。
- `gh`で本人identityを取得できる。
- `npm run setup:survey-data`でdata repositoryを独立clone済みである。
- cloneの`origin`とGitHub上のcanonical repository identityが一致する。
- **data repositoryがprivateである**。回答は本人branchへpushされるため、
  public/internalなrepositoryでは設問を出す前に停止する。

## Behavior

1. CLI引数と回答を検証する。
2. GitHub numeric user IDとlogin snapshotを解決する。
3. data repositoryのprivate visibilityを検証する。
4. repository lockを取得する。
5. 本人branch `responses/github-<numeric-id>` を作成またはswitchする。
6. definition snapshotとresponseをatomic writeする。
7. publish modeなら2 pathだけをstage・commitし、本人branchへpushする。
8. 結果を表示し、lockを解放する。

`--save-only`はlocal本人branchへの保存で止め、commit/pushを行わない。省略時はpublishする。
publishには`dataRepository.allowRemotePublish: true`が必要であり、設定が無ければ
pushせず失敗する。`main`へ回答を書かない。

## Privacy

- 回答、体験データ、media、persona分析は両repositoryのignore境界で保護する。
- token、email、OAuth payload、raw GitHub profileを保存・ログ出力しない。
- エラーには回答値や入力ファイルの機微なbasenameを含めない。
