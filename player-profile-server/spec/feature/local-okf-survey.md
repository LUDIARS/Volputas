---
type: feature
title: "Local survey"
description: "公開アンケート定義を独立cloneし、本人回答をremoteへ送らずローカル保存する機能。"
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

利用者として、Volputas serverやPostgreSQLを起動せずに公開アンケートへ回答し、
回答を自分のPCだけへ保存したい。回答はcanonical public repositoryへ送信されない。

## Preconditions

- Node.js 20以上、Git、GitHub CLIが利用できる。
- `gh`で本人identityを取得できる。
- `npm run setup:survey-data`で`VolputasData`を独立clone済みである。
- cloneの`origin`とGitHub上のcanonical repository identityが一致する。

## Behavior

1. CLI引数と回答を検証する。
2. GitHub numeric user IDとlogin snapshotを解決する。
3. repository lockを取得する。
4. definition snapshotとresponseをatomic writeする。
5. local-only結果を表示し、lockを解放する。

`--save-only`の有無にかかわらずremote publicationは行わない。公開定義や匿名サンプルを
更新する場合は、通常のbranch・PR workflowを別途使用する。

## Privacy

- 回答、体験データ、media、persona分析は両repositoryのignore境界で保護する。
- token、email、OAuth payload、raw GitHub profileを保存・ログ出力しない。
- エラーには回答値や入力ファイルの機微なbasenameを含めない。
