---
type: plan
title: "Local-only OKF survey data architecture"
description: "Voluptas のアンケートをサービスDBなしで実行し、private data submodule の回答者別branchへOKFファイルとして保存・publishする設計宣言。"
service: voluptas
domain: persistence
tags:
  - local-first
  - survey
  - okf
  - github-identity
  - git-submodule
  - privacy
status: implemented
related:
  - ../feature/local-okf-survey.md
  - ../interface/local-survey-git-workflow.md
  - ../setup/local-okf-survey.md
  - ../test/local-okf-survey.md
  - ../data/data-schema.md
updated: 2026-07-23
---

# Local-only OKF survey data architecture

## 設計宣言

Voluptas（Vo）のローカルアンケートは、HTTP server、Voluptas JWT、PostgreSQLを起動せずに
`npm run survey:local` だけで実行できるものとする。設問定義と本人回答は、親repositoryから
分離したprivate repositoryを `player-profile-server/private/survey-data` にsubmoduleとして配置し、
可読かつ機械処理可能なOKF v0.1 Markdownとして保存する。

保存主体の同一性は、その端末で認証済みのGitHub CLIから取得する。安定キーはGitHubのnumeric user ID、
loginは人が確認するための可変メタデータである。回答は `responses/github-<numeric-id>` branchへ
commitし、既定動作ではそのbranchをprivate remoteへpushする。

ここでいう「ローカルのみ」は、Voluptasの常駐serviceや共有DBを必要としないという意味である。
GitHub identityの確認とprivate remoteへのpushにはGitHubへの通信が発生する。完全offline動作や
匿名回答を意味しない。

## 背景

既存のアンケート経路は `surveys` と `survey_responses` をPostgreSQLへ保存し、Voluptas認証済みSIDを
回答者キーとしている。この構成はserver運用には適するが、個人がローカルで資料として回答を保持する
用途では、DBの準備、サービス認証、データ所在の把握が重い。また回答はセンシティブになり得るため、
アプリケーションコードと同じrepositoryへ直接置かない保護境界が必要である。

## 目標

- Node.js、Git、GitHub CLIだけでアンケートを実行し、PostgreSQLなしで回答を保存できる。
- 設問定義と回答をOKF v0.1 Markdownとして人とプログラムの双方が読める。
- GitHubのnumeric user IDで同一人物を安定して識別し、現在のloginも目視確認できる。
- センシティブな回答をprivate data repositoryへ隔離し、回答者単位のbranchへpublishする。
- 生成対象だけをatomicに書き、exact-pathでstageし、commit/pushの失敗を検出する。
- 同じsubmoduleを使う同時実行をlockで直列化する。
- tokenと回答本文をログ、例外、commit messageへ漏らさない。
- 保持と削除について、working tree上の削除とGit履歴からの消去を区別する。
- 既存PostgreSQL経路を壊さず、互換経路として明確に位置付ける。

## 非目標

- ローカルCLIをGitHub OAuth applicationや新しいVoluptas IdPにすること。
- GitHub loginを永続的な本人キーとして扱うこと、またはCLI引数で別人を偽装できるようにすること。
- 回答をpublic repository、親Voluptas repository、通常のapplication logへ保存すること。
- 回答をPostgreSQLへ暗黙にdual-writeすること。
- ローカル回答を直ちに既存の12次元・15軸・20次元分析へ取り込むこと。
- 保存済みOKFをtyped valueへ読み戻すapplication parser/importerをv0.1で提供すること。
- 複数回答者のbranchを自動mergeして、一つの集計branchを作ること。
- 親repositoryのgitlinkをCLIからcommit/pushすること。
- Git履歴書き換えを通常の回答保存CLIから自動実行すること。
- private repositoryそのものをCLIが自動作成したり、可視性・collaboratorを変更したりすること。

## システム境界

```text
回答者
  │
  │ npm run survey:local
  ▼
Voluptas local survey CLI
  ├─ config/local-survey.json        非secret既定値
  ├─ GitHub CLI                      authenticated userの id/login 取得
  └─ private/survey-data             private repositoryのsubmodule
       ├─ surveys/gamer-preferences.md
       └─ responses/github-<id>/gamer-preferences.md
                    │
                    │ commit + push
                    ▼
       remote branch responses/github-<id>

既存 server mode
  └─ /api/v1/surveys → PostgreSQL    互換経路。local modeとは自動同期しない
```

## 配置と正本

| 対象 | canonical path / ref | 位置付け |
|---|---|---|
| 非secret設定 | `player-profile-server/config/local-survey.json` | local surveyの既定値 |
| data checkout | `player-profile-server/private/survey-data` | private repository submodule |
| base branch | `main` | 非センシティブなOKF bootstrap skeletonだけ |
| 設問snapshot | 本人branchの `surveys/gamer-preferences.md` | 回答時点の完全なOKF v0.1 definition |
| 本人回答 | 本人branchの `responses/github-<id>/gamer-preferences.md` | local mode回答の正本 |
| publish先 | `refs/heads/responses/github-<id>` | 回答者単位のremote branch |
| optional override | `VOLUPTAS_SURVEY_DATA_DIR` | test・別checkout用のdata directory差し替え |

`VOLUPTAS_SURVEY_DATA_DIR` は任意であり、通常利用で環境変数を要求しない。repository URL、
GitHub token、回答、個人情報を `config/local-survey.json` や環境変数へ置かない。

data repositoryの `main` はbranch作成用の非センシティブなdirectory/OKF skeletonだけを持ち、
実回答や回答時点の完全なdefinition snapshotを持たない。本人branchにはdefinitionと本人responseを
同じcommitで置く。親repositoryの `.gitmodules` はこのdata submoduleに `ignore = all` を設定し、
本人branchのHEAD/gitlink変化を通常の親status・commit候補へ出さない。CLIはこの設定に依存して
親gitlinkを更新するのではなく、親indexを一切操作しない。

## OKF v0.1 profile

OKF v0.1は、この機能が採用するproject-local profile名である。媒体はUTF-8（BOMなし、LF）の
Markdown、メタデータはYAML frontmatter、構造化本体は一つのdeterministic JSON fenceとする。
OKFの最小原則である `type` を満たし、次の2 record typeを定義する。

| `type` | 用途 | 主要拡張field |
|---|---|---|
| `Survey Definition` | 設問snapshot | `okf_version`, `survey_id`, `survey_version` (`1.0.0`) |
| `Survey Response` | 本人回答 | definitionのfieldに加えて `github_user_id`, `github_login`, `producer_revision`, `timestamp` |

authoritative dataはJSON fenceであり、見出しや説明文は人向け表示である。serializerは同じ入力から
byte-for-byte同じ出力を作り、object key順、改行、末尾改行を固定する。回答Markdownと
authoritative JSONの `survey_definition` は、bundle-absolute resource
`/surveys/gamer-preferences.md` を参照する。`survey_id` と `survey_version` が一致しなければ
読み込まない。

`github_user_id` は精度低下を避けるため10進文字列として保持する。`github_login` は保存時点の
表示用snapshotであり、login変更時は同じnumeric IDのrecordを更新する。token、email、実名、
avatar、GitHub APIのraw responseはrecordへ含めない。

## 主要決定

| ID | 決定 | 理由 |
|---|---|---|
| D-01 | server不要のlocal CLIを独立した入口にする | DB・JWT準備なしで資料化できるようにする |
| D-02 | dataはprivate repositoryのsubmoduleに置く | application codeとセンシティブデータのaccess boundaryを分離する |
| D-03 | OKF v0.1 Markdown + deterministic JSONを正本にする | diff可読性と型付き処理を両立する |
| D-04 | `gh api user` のnumeric IDを本人キー、loginを表示値にする | login renameで同一性を失わない |
| D-05 | branchを `responses/github-<id>` に固定する | 回答者間の通常commit競合と誤混在を減らす |
| D-06 | definitionとresponseを同じdata commitへ含める | 回答時に使った設問を再現可能にする |
| D-07 | 同一directoryのtemporary fileからatomic replaceする | 中断時にpartial Markdownを正本にしない |
| D-08 | stage対象を生成した2 pathへ限定する | 無関係・別人のデータをcommitへ混入させない |
| D-09 | data directory単位のexclusive lockを使う | branch切替、write、commit、pushを同時実行させない |
| D-10 | private remoteとbranchを検証し、force pushしない | 誤公開とremote側更新の破壊を防ぐ |
| D-11 | local responseはsubmoduleを正本、PostgreSQLは互換経路とする | dual-write競合を作らず段階移行する |
| D-12 | tokenと回答値を全operation logから除外する | private repo外への二次漏えいを防ぐ |
| D-13 | 通常削除と履歴消去を別手順にする | Gitの履歴保持特性を隠さない |
| D-14 | 非secret既定値はversioned JSON configへ置く | 通常利用に環境変数を要求せず再現性を保つ |
| D-15 | data `main` はbootstrap skeletonだけ、完全なdefinition/responseは本人branchだけに置く | mainから回答系データを分離し、definition lineageを回答と同じcommitで固定する |
| D-16 | 親submodule設定を `ignore = all` とし、親gitlinkを操作しない | response commitをpublic parentへ誤stageする経路を閉じる |

## Local GitHub identityの設計例外

通常のVoluptas server modeはサービスSIDとfederated identityを認証境界にする。一方local-only
modeではサービスを起動しないため、次の限定された例外を採用する。

1. 端末で既に認証済みのGitHub CLIだけをidentity brokerとして使う。
2. CLI自身はtokenを取得、表示、保存しない。`gh auth token` を呼ばない。
3. identityはGitHub APIが返すpositive numeric `id` と `login` の組だけを受け入れる。
4. branch名、response directory、authority判定はnumeric IDだけから導出する。
5. loginは確認表示とOKF metadataにだけ使い、authority判定に使わない。
6. identityを上書きするCLI optionやconfig fieldは設けない。

この例外はprivate data submoduleへのlocal survey保存だけに適用し、既存APIの認証方式や
`federated_identities` tableを変更しない。

## Security and privacy invariants

- remote repositoryがprivateであることをGitHub APIで確認できなければ、実データを書かない。
- data directoryが期待したGit repository/submoduleでなければ失敗する。
- remote URLへtokenを埋め込まず、Git/GitHub CLIのcredential管理に委ねる。
- stdout/stderrにはquestion ID、処理段階、path、commit SHAまでを出してよいが、回答値を出さない。
- validation errorは「どのquestionが不正か」を示し、不正値をechoしない。
- temporary file、lock file、commit message、branch名に回答やloginを含めない。
- 回答fileのmode、repository access、remote visibilityのいずれかが検証できなければfail closedとする。
- `git add -A`、`git add .`、親repositoryでのstage、automatic force pushを禁止する。

## 保持と削除

v0.1は各回答者・surveyにつきcurrent response fileを一つ持ち、再回答では同じpathを新しいcommitで
更新する。governance ownerは `LUDIARS/Voluptas-Data` repository administratorsとする。
response branchのactive retentionは最終submissionから最大365日、または本人削除依頼の早い方までとする。
削除依頼は受付から30日以内に本人確認と通常branch削除を完了する。administratorsはquarterlyに
repository access、各response branchの最終submission、期限超過、未完了削除依頼をreviewする。
response branchを `main` へmergeしない。

本人から通常削除の依頼があった場合は、本人確認後にremote/localの
`responses/github-<id>` branchを削除する。これによりcurrent reachable branchからdefinition/responseは
消えるが、remoteの到達不能object、clone、backupには残り得る。履歴からの消去が必要な場合は、
repository管理者が対象numeric IDとsurvey pathを確認し、履歴書き換え、branch/tagの
到達性、GitHub側cache、clone、backupの期限を含むincident扱いでorganization ownerへescalateする。
organization ownerはGitHub Supportとbackup手順を使い、消去できた範囲と残存範囲を回答値なしで記録する。
通常CLIはこの操作を自動化しない。

## 段階導入

1. private data repositoryを作成し、可視性・access・retention ownerを確定する。
2. canonical pathへsubmoduleを登録し、非secret configを追加する。
3. OKF deterministic serializer、question/answer validation、atomic writerを実装する。
4. GitHub identity、privacy guard、lock、branch、exact-stage、commit/push workflowを実装する。
5. `--save-only` と既定publish動作を結合し、failure injection testを通す。
6. test用回答でprivate branchを確認してから、実回答の収集を許可する。
7. 必要になった時点で、OKF正本からPostgreSQL互換projectionを作る明示importerを別設計する。

## 完了条件

- fresh checkoutでsubmodule setup後、DBなしでinteractive surveyが完了する。
- `--answers` でも同じvalidationと同じcanonical outputを得る。
- definitionとresponseがvalid YAML frontmatterとauthoritative JSON fenceを持ち、responseはnumeric
  GitHub IDに紐付く。application parser/importerはv0.1完了条件に含めない。
- 既定動作が `responses/github-<id>` へcommit/pushする。`--save-only` はlocal本人branchを
  作成・switchしてよいが、fetch、stage、commit、pushを行わない。
- concurrent実行の一方だけがlockを取得し、partial fileや混在commitが生じない。
- staged/committed pathはcanonical definitionと当該本人responseだけである。
- public remote、identity不明、push競合、dirty repositoryでは安全側に失敗する。
- captured stdout/stderr、commit message、lock fileにtoken・回答値が存在しない。
- 既存PostgreSQL migration/API/testはlocal mode追加によって破壊されない。
