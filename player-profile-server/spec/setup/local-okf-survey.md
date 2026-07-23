---
type: setup
title: "Local OKF survey setup"
description: "Voluptas-Data private repository、submodule、GitHub CLI identity、non-secret configを準備し、local surveyを安全に実行する手順。"
service: voluptas
domain: tooling
tags:
  - setup
  - github-cli
  - git-submodule
  - private-repository
  - okf
status: implemented
related:
  - ../plan/local-okf-survey-data.md
  - ../feature/local-okf-survey.md
  - ../interface/local-survey-git-workflow.md
  - ../test/local-okf-survey.md
updated: 2026-07-23
---

# Local OKF survey setup

## Prerequisites

- Node.js 20以上
- Git
- GitHub CLI (`gh`)
- private repository `LUDIARS/Voluptas-Data` へのread/write権限
- Voluptas repositoryとprivate submoduleを保存できるlocal filesystem

PostgreSQL、Redis、Voluptas server、Google/Discord OAuth設定はlocal surveyには不要である。

## Private repository preparation

repository ownerは実回答を受け付ける前に、`LUDIARS/Voluptas-Data` について次を確認する。

- visibilityが `PRIVATE` である。
- 必要な回答者・管理者だけにaccessがある。
- private forkを含むfork policyが意図どおりである。
- default branchは `main` で、初期化済みである。
- `main` は非センシティブなOKF bootstrap skeletonだけを持ち、実回答や完全な回答時definitionを持たない。
- branch pattern `responses/github-*` を作成・pushできる。
- CI、bot、webhookがresponse本文をlogや外部serviceへ送らない。
- governance ownerが `LUDIARS/Voluptas-Data` repository administratorsである。
- response branchを最終submissionから最大365日、または本人削除依頼の早い方で削除する。
- 本人削除依頼を30日以内に処理する受付・本人確認・branch削除手順がある。
- quarterly access/retention reviewの担当と記録先がある。
- response branchを `main` へmergeしない。
- 完全消去要求をorganization ownerからGitHub Support/backup手順へescalateするrunbookがある。

visibilityはGitHub CLIでread-only確認する。

```powershell
gh repo view LUDIARS/Voluptas-Data --json visibility --jq .visibility
```

期待値は `PRIVATE` である。確認できない場合や `PUBLIC` / `INTERNAL` の場合は、local surveyを
実行しない。survey CLI自身はrepository作成やvisibility変更を行わない。

## Authenticate GitHub CLI

```powershell
gh auth status
gh api user --jq '{id: .id, login: .login}'
```

2つ目のcommandが、現在のGitHub numeric IDとloginを返すことを確認する。numeric IDが本人同一性の
stable keyであり、loginは表示用である。shared OS accountで別人のGitHub CLI sessionを使い回さない。
意図したaccountと違う場合は `gh auth switch` でactive accountを切り替え、`gh api user` を再確認する。

Git credential helperの準備が必要な場合は、利用者自身が `gh auth setup-git` を実行する。
tokenをURL、`config/local-survey.json`、`.env`、shell historyへ貼らない。`gh auth token` の出力を
setup確認に使わない。

## Initialize submodules

Voluptas repository rootでsubmodule設定を同期し、canonical pathを取得する。

```powershell
git submodule sync -- player-profile-server/private/survey-data
git submodule update --init -- player-profile-server/private/survey-data
```

survey data submodule専用のproject scriptを使う場合は次でもよい。

```powershell
# Voluptas repository rootから実行
npm --prefix player-profile-server run setup:survey-data
```

既存 `npm run setup:submodules` はLapilli code dependency用であり、private survey dataのsetupを
代替しない。

private repository accessがない状態でpublic fallbackや空directoryを作らない。clone失敗を解消し、
次を確認する。

```powershell
git -C player-profile-server/private/survey-data rev-parse --show-toplevel
git -C player-profile-server/private/survey-data remote get-url origin
git -C player-profile-server/private/survey-data status --short --branch
```

remote URLの期待値は `https://github.com/LUDIARS/Voluptas-Data.git` である。credentialを埋め込んだ
URLへ変更しない。

親 `.gitmodules` のdata submodule entryには `branch = main` と `ignore = all` が必要である。

```ini
[submodule "player-profile-server/private/survey-data"]
	path = player-profile-server/private/survey-data
	url = https://github.com/LUDIARS/Voluptas-Data.git
	branch = main
	ignore = all
```

`ignore = all` は、本人response branchのHEADをpublicな親repositoryの通常status/stage候補へ出さない
ためのguardである。private visibilityやCLIのexact stagingを代替しない。

## Non-secret configuration

canonical configは `player-profile-server/config/local-survey.json` である。

```json
{
  "schemaVersion": 1,
  "dataRepository": {
    "path": "private/survey-data",
    "remote": "origin",
    "githubRepository": "LUDIARS/Voluptas-Data",
    "expectedRemoteUrl": "https://github.com/LUDIARS/Voluptas-Data.git",
    "baseBranch": "main",
    "responseBranchPrefix": "responses/github-"
  },
  "commands": {
    "git": "git",
    "github": "gh"
  }
}
```

このfileは非secret既定値だけを持つ。token、credential、回答、GitHub numeric ID/login、
local absolute pathをcommitしない。`githubRepository` と `expectedRemoteUrl` は同じ
`LUDIARS/Voluptas-Data` を指さなければconfig load時に失敗する。`schemaVersion` はnumeric `1` に
固定し、unknown versionを黙って解釈しない。通常利用では環境変数は不要である。

### Optional data directory override

test repositoryや別checkoutを使う場合だけ `VOLUPTAS_SURVEY_DATA_DIR` でdata directoryを差し替える。

```powershell
$env:VOLUPTAS_SURVEY_DATA_DIR = 'E:\tmp\voluptas-survey-data-test'
npm --prefix player-profile-server run survey:local -- --save-only
Remove-Item Env:VOLUPTAS_SURVEY_DATA_DIR
```

overrideはrepository URLやprivacy requirementを変更しない。relative valueは
`player-profile-server` root基準で解決する。filesystem rootや親Voluptas repositoryを指定しない。
実回答を一時test repositoryへ保存しない。

## Node dependency note

local survey CLIはNode.js built-in moduleだけを使うため、回答だけなら `npm install` は不要である。
`npm run` はpackage script launcherとして使う。Voluptas server、全test、分析機能も扱う場合は、
Voluptas repository rootから先に
`npm --prefix player-profile-server run setup:submodules` でLapilliを初期化してから
`npm --prefix player-profile-server install` を行う。
local surveyのためにDB migrationやserver起動を行う必要はない。

## First-run verification

最初は実回答ではなく、private repository ownerが許可したtest account/test dataを使う。

1. `gh api user` のnumeric IDとloginが意図したtest identityであることを確認する。
2. private visibilityとremote URLを確認する。
3. data submoduleがcleanで、merge/rebase等が進行中でないことを確認する。
4. UTF-8 JSON test fixtureを用意し、全question IDへvalid answerを入れる。
5. まず `--save-only` でlocal本人branchの作成/switch、render、validation、pathだけを確認する。
6. generated fileを表示する場合も、screen recording、terminal log、chat添付へ実回答を残さない。
7. test fileを戻した後、既定publishでtest branchへcommit/pushできることを確認する。
8. commit changed pathがdefinitionとtest identityのresponseだけであることを確認する。

```powershell
# Voluptas repository rootから実行。answers pathはplayer-profile-server基準
npm --prefix player-profile-server run survey:local -- --answers .\spec\test\fixtures\gamer-preferences.valid.json --save-only
npm --prefix player-profile-server run survey:local -- --answers .\spec\test\fixtures\gamer-preferences.valid.json
```

`--answers` はUTF-8 JSON file pathを受け取る。inline JSONを渡さない。fixtureは次の形の完全な
answer objectであり、placeholderや一部questionだけの例はvalidationを通らない。

```json
{
  "<question-id>": "<definitionに適合するtest value>"
}
```

test fixtureへ実回答を入れたり、public Voluptas repositoryへcommitしたりしない。

## Normal use

```powershell
# Voluptas repository rootから実行
npm --prefix player-profile-server run survey:local
```

CLIが表示した `github_login (github_user_id)` を回答開始前に確認する。interactive completion後、
既定では次がprivate remoteへpublishされる。

```text
branch: responses/github-<github_user_id>
files:
  surveys/gamer-preferences.md
  responses/github-<github_user_id>/gamer-preferences.md
```

回答内容をpublish前に手動確認する運用では `--save-only` を使う。このmodeも
`responses/github-<id>` local branchへswitchし、`main` へ回答を書かないが、fetch/commit/pushはしない。
確認後に通常commandを再実行してpublishする。手動で `git add .` や `git add -A` を使わない。

## Parent repository handling

submodule内でbranch/commitが進んでも、`ignore = all` により親Voluptas repositoryの通常statusには
gitlink差分が表示されない。これはgitlinkが自動更新されたという意味ではなく、回答commitを
親application branchへ入れる指示でもない。

```powershell
git status --short
git -C player-profile-server/private/survey-data status --short --branch
```

親repositoryで回答dataやgitlinkをstage/commitしない。lockはsubmoduleのGit metadata内にある
`voluptas-survey.lock` でありworking treeへ置かない。`ignore = all` を
外してresponse HEADを親commitへ取り込まない。共有branchの更新が別目的で
必要な場合は、data governance ownerの承認を得た独立taskとして扱う。

## Troubleshooting

| Symptom | Check | Safe action |
|---|---|---|
| GitHub identityを取得できない | `gh auth status` | 正しいaccountで再認証する。ID overrideは使わない |
| submodule clone/pushが403 | collaborator権限、credential helper | repository ownerへaccessを依頼する。tokenをURLへ入れない |
| private checkが失敗 | `gh repo view ... --json visibility` | visibilityを確認できるまで回答を書かない |
| lock already exists | 他のlocal survey process、`git rev-parse --git-path voluptas-survey.lock` | active processを待つ。CLIはstale lockを自動削除しない |
| dirty repository | submodule内 `git status --short` | file contentを確認し、CLIにstash/reset/cleanさせない |
| non-fast-forward push | remote本人branchの新commit | forceせずfetchし、人が回答revisionを選ぶ |
| `--answers` validation error | UTF-8、JSON object、question ID/type | answer valueをchat/logへ貼らずlocalで修正する |
| parent gitlinkを明示検査すると差分がある | `.gitmodules` の `ignore = all`、submodule status | 親indexへstageせず、response HEADをpublic parentへ記録しない |

## Offboarding and deletion readiness

回答者のaccessを外す前に、その人のbranchと削除要求の有無を確認する。access removalは回答削除ではない。
通常削除では本人確認後にremote/localの本人branchを削除する。branch削除、history purge、
clone/backup expirationは別々に記録し、どこまで完了したかを回答値なしの監査記録へ残す。
repository administratorsは最終submissionから365日を超えるbranchと削除依頼をquarterlyに確認し、
依頼は30日以内に処理する。完全消去要求はorganization ownerへescalateする。
