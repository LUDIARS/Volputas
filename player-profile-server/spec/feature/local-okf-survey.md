---
type: feature
title: "Local OKF survey"
description: "GitHub CLI identityを使い、アンケート定義と本人回答をprivate data submoduleへ保存して回答者branchへpublishするlocal-only機能。"
service: voluptas
domain: survey
tags:
  - cli
  - local-first
  - okf
  - github-identity
  - privacy
status: implemented
related:
  - ../plan/local-okf-survey-data.md
  - ../interface/local-survey-git-workflow.md
  - ../setup/local-okf-survey.md
  - ../test/local-okf-survey.md
  - ../data/data-schema.md
updated: 2026-07-23
---

# Local OKF survey

## User story

GitHub CLIへログイン済みの回答者として、Voluptas serverやPostgreSQLを起動せずに
`gamer-preferences` アンケートへ回答したい。回答時の設問と回答をprivate data repositoryへ
可読な資料として残し、自分のGitHub numeric IDから一意に決まるbranchへ安全にpushしたい。

## Entry point

```powershell
# Interactive input（default）
npm run survey:local

# UTF-8 JSON fileから非対話入力
npm run survey:local -- --answers .\answers.json

# definition/responseの保存だけを行い、commit/pushしない
npm run survey:local -- --save-only

# file入力を保存だけ行う
npm run survey:local -- --answers .\answers.json --save-only
```

`--answers` の値はinline JSONではなく、UTF-8 JSON fileへのfilesystem pathである。JSON objectは
question IDをkey、回答をvalueとする。CLIはinput fileの内容やanswer objectをstdout/stderrへ
表示しない。file size上限は1 MiBとする。未知option、missing option value、読めないfile、
invalid UTF-8、JSON以外の内容はwrite前に失敗する。

`--save-only` を指定しない既定動作は、definitionとresponseを保存し、生成pathだけをcommitして
`responses/github-<numeric-id>` へpushすることである。`--save-only` はlocal本人branchを
作成・switchしてそこへ保存するが、fetch、stage、commit、pushを省略する。

## Preconditions

- `player-profile-server/config/local-survey.json` が有効である。
- canonical data directory、または `VOLUPTAS_SURVEY_DATA_DIR` のoverride先がGit repositoryである。
- data remoteがprivate GitHub repositoryとして検証できる。
- runtimeの `gh api user` から本人のnumeric `id` と `login` を取得できる。
- data directoryに別operationのlockがなく、既存の未処理変更がworkflowの安全条件を満たす。
- publish modeではremoteへのfetch/push権限がある。

preconditionを満たさない場合は、設問回答の入力前、または遅くとも正本fileの置換前に失敗する。
GitHub tokenの再入力や別identityの指定をCLIから求めない。

## Functional flow

1. versioned configを読み、optional directory overrideを解決する。
2. GitHub CLIから `{ id, login }` だけを取得し、形式を検証する。
3. expected GitHub repositoryのprivate visibilityを検証する。
4. built-in `gamer-preferences` definitionを読み、interactiveまたは `--answers` fileから回答を得る。
5. 全questionへの回答、型、choice membership、自由記述制約を検証し、OKF v0.1 definition/responseを
   memory上でdeterministicにrenderする。
6. data repositoryのGit metadata内にexclusive lockを取得する。
7. submodule top-levelとfetch/push remoteを検証する。
8. `responses/github-<id>` local branchを作成またはswitchし、`main` 上へ回答を書かない。
   publish modeだけは先にremoteをfetchし、本人branchをsafe fast-forwardする。
9. 次の2 fileをsame-directory temporary file経由で各file単位にatomic置換する。
10. `--save-only` ならlocal本人branchのworking treeに2 fileを残し、Git index/commit/remoteを変更せず終了する。
11. publish modeなら2 pathだけをstageし、変更がある場合だけcommitして本人branchへpushする。
12. 成否にかかわらずtemporary artifactを清掃し、lockを解放する。

生成pathは次のとおりである。

```text
private/survey-data/
├── surveys/
│   └── gamer-preferences.md
└── responses/
    └── github-<numeric-id>/
        └── gamer-preferences.md
```

branch名とresponse directoryは同じnumeric IDから導出する。`github_login` をpathやbranchへ使わない。
完全なdefinitionとresponseはこの本人branchにだけ保存する。data repositoryの `main` は
非センシティブなOKF bootstrap skeletonだけであり、回答や完全な回答時definitionの正本ではない。

## OKF v0.1 records

### Survey Definition

definitionは次のmetadataを持つ。

| field | 制約 |
|---|---|
| `type` | exactly `Survey Definition` |
| `okf_version` | exactly string `0.1` |
| `survey_id` | exactly `gamer-preferences` |
| `survey_version` | exactly semantic-version string `1.0.0` |

frontmatterは `title`, `description`, `resource`, `tags` も持つ。Markdown bodyにはtitle、
descriptionとauthoritative deterministic JSON fenceを一つ置く。JSONには
`description`, `kind`, `okf_version`, `questions`, `survey_id`, `survey_version`, `title` を保持し、
`kind` は `voluptas.survey_definition` とする。

### Survey Response

responseはdefinitionを識別するfieldに加えて次を持つ。

| field | 制約 |
|---|---|
| `type` | exactly `Survey Response` |
| `github_user_id` | GitHub APIが返したpositive numeric IDの10進文字列 |
| `github_login` | 保存時点のGitHub login。authorityには使わない |
| `producer_revision` | fileを生成したVoluptas revision |
| `timestamp` | UTC ISO 8601 timestamp |

bodyは bundle-absolute `/surveys/gamer-preferences.md` へのlinkと、authoritative deterministic JSON fenceを
一つ持つ。JSONは `answers`, `github_identity`, `kind`, `okf_version`, `producer_revision`,
`submitted_at`, `survey_definition`, `survey_id`, `survey_version` を保持する。
`kind` は `voluptas.survey_response`、`survey_definition` は
`/surveys/gamer-preferences.md`、`github_identity` は `{ id, login }` とする。
human-readable proseへ回答を複製しない。

frontmatterとJSONの同じfieldが矛盾したrecord、unknown OKF/survey version、definitionとのquestion集合が
不一致なrecordはformat上invalidである。`timestamp` はUTC ISO 8601 milliseconds形式、
`producer_revision` はlowercase Git object IDのcanonical formとする。

現行v0.1の実装範囲はvalidation済みinputのdeterministic renderingであり、保存済みOKFをtyped valueへ
読み戻すapplication parser/importerは含まない。将来readerを追加する場合は、invalid recordの片側だけを
優先して黙って読み進めてはならない。

## Answer validation

- answer objectのkey集合はdefinitionのquestion ID集合と完全一致する。
- required questionの欠落と未知questionの混入をどちらも拒否する。
- `choice` 回答はstringで、definitionに存在するoption valueだけを受け入れる。
- freetextは空でないstring、最大2,000 Unicode code pointsとする。
- unsafe control characterとunpaired surrogateを拒否する。
- JSONのprototype keyやpath traversalに使える値をfile pathへ展開しない。
- validation errorはquestion IDとreasonだけを示し、answer valueをmessageへ含めない。

local OKF v0.1が受け入れるquestion typeは `choice` と `freetext` である。その他のtypeを含む
definitionは回答値を解釈せずに拒否する。

回答の意味的な採点や人格・医療・法的評価はvalidationの責務ではない。

## GitHub identity behavior

identity sourceはlocal GitHub CLIに固定する。GitHub numeric IDをstable authority、loginを
human-readable metadataとして扱う。

- 同じnumeric IDでloginだけが変わった場合は同じresponse path/branchを更新する。
- 同じloginに見えてnumeric IDが異なる場合は別人である。
- `--github-id`、`--login`、configによるidentity overrideを提供しない。
- GitHub APIのraw response、email、name、avatar、organizationsを保存しない。
- `gh auth token` を呼ばず、tokenをprocess argument、environment、logへ複製しない。

interactive modeでは回答開始前に `github_login (github_user_id)` を本人確認用に表示してよい。
この表示にtokenや回答を含めない。

## Save-only behavior

`--save-only` はserializer、validation、privacy guard、lock、local本人branchの作成/switch、atomic writeを
通常どおり実行する。remote fetch、stage、commit、pushは行わない。作成・更新した2 pathは本人branchの
working tree changeとして残り、`main` へ回答を書かない。
CLIは保存pathを報告してよいが、file contentを表示しない。

既に別変更があるrepositoryへsave-onlyする場合も、対象fileを上書きしてよいか判定できなければ
fail closedとする。別人のresponseや無関係なfileを変更・stage・cleanupしない。

## Publish behavior

publish modeは [local survey Git workflow](../interface/local-survey-git-workflow.md) の全invariantに従う。

- local/remote branchは `responses/github-<id>` に一致する。
- remote更新をfast-forwardできない場合はpushせず、forceしない。
- stage/commit対象はdefinitionと当該responseのexact pathだけである。
- no-op serializationでは空commitを作らない。
- commit messageに回答、login、自由記述を入れない。
- push成功を確認するまで「published」と表示しない。
- 親Voluptas repositoryのgitlinkや他fileをstage/commitしない。
- 親 `.gitmodules` の `ignore = all` を維持し、response branch HEADをpublic parent commitへ反映しない。

## Error and recovery

| Failure | Required result |
|---|---|
| identityを取得できない | write/commit/pushなし |
| remoteがpublicまたはprivacy不明 | write/commit/pushなし |
| answer validation failure | 既存responseを維持し、回答値をlogしない |
| atomic rename前のfailure | 既存canonical fileを維持する |
| lock contention | branch操作やwriteを始めず失敗する |
| commit failure | pushせず、生成fileと診断可能なGit stateを保持する |
| non-fast-forward push | forceせず、local commitを保持して明示的な解決を要求する |
| process interruption | temporary fileをcanonical recordとして扱わない。残存lockは次回 `LOCK_HELD` とし、人がactive process不在を確認する |

CLIのerrorはoperation stageとremediationを示す。ただしGitHub token、answer object、自由記述、
JSON source全体を含めない。

## Retention and deletion

再回答は同じresponse pathを更新するため、current treeには最新版だけがある。過去回答はprivate
Git historyに残る。v0.1の通常削除は本人確認後にremote/localの
`responses/github-<id>` branchを削除する管理operationであり、履歴消去ではない。

`LUDIARS/Voluptas-Data` repository administratorsは、最終submissionから最大365日または本人削除依頼の
早い方でresponse branchを削除し、依頼時は30日以内に完了する。quarterly access/retention reviewを行い、
response branchを `main` へmergeしない。

履歴からの完全消去要求はorganization ownerがGitHub Support/backup手順へescalateする。
通常の `survey:local` はhistory rewriteやforce pushを行わず、削除済みだと誤表示しない。
詳細は [保持と削除](../interface/local-survey-git-workflow.md#保持と削除) を参照する。

## Compatibility

既存 `/api/v1/surveys` とPostgreSQL tableはserver mode互換として残る。local CLIはDB接続を要求せず、
回答をDBへdual-writeしない。将来のimporterはOKF responseをsourceとして明示的に起動し、
source commit SHAを記録した再生成可能なprojectionに限定する。
