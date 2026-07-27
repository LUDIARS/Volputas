---
type: interface
title: "Local survey Git workflow"
description: "Private survey-data submoduleに対するidentity解決、branch操作、atomic write、exact staging、commit/push、lock、削除のinterface contract。"
service: voluptas
domain: persistence
tags:
  - git
  - github-cli
  - submodule
  - concurrency
  - privacy
status: implemented
related:
  - ../plan/local-okf-survey-data.md
  - ../feature/local-okf-survey.md
  - ../setup/local-okf-survey.md
  - ../test/local-okf-survey.md
  - ../data/data-schema.md
updated: 2026-07-23
---

# Local survey Git workflow

## Scope

このinterfaceは、local survey CLIがprivate data submoduleへdefinition/responseを書き、
回答者専用branchへcommit/pushする境界を定義する。GitHub repositoryの作成、visibility変更、
collaborator管理、親Voluptas repositoryのcommitは含まない。

## Invariants

1. data repositoryは設定されたcanonical directoryにあり、GitHub上でprivateと確認できる。
2. identityはlocal GitHub CLIから取得し、numeric IDだけでbranch/pathを決める。
3. 一つのdata directoryでは、一度に一つのsurvey Git operationだけが実行される。
4. canonical fileはsame-directory temporary fileからatomic replaceする。
5. Git indexへ追加するのはdefinition pathと当該本人のresponse pathだけである。
6. commit message、process output、lock metadataへtoken・回答値を入れない。
7. pushはexplicit refspecかつnon-forceであり、remote競合を上書きしない。
8. `--save-only` はlocal本人branchを作成・switchしてよいが、fetch、index、commit、remote refを変更しない。
9. 親repositoryのindex、branch、gitlinkをstage/commitしない。
10. 成功条件を満たす前にlockを解放したり「published」と報告したりしない。
11. data `main` は非センシティブなbootstrap skeletonだけとし、完全なdefinition/responseは本人branchだけへ置く。

## Configuration resolution

1. package rootの `config/local-survey.json` を読み、top-level `schemaVersion` がexactly numeric `1`
   であることを確認する。
2. `VOLUPTAS_SURVEY_DATA_DIR` が空でなければdata directoryだけをoverrideする。
3. relative pathはcurrent working directoryではなく `player-profile-server` rootから解決する。
4. real pathを正規化し、filesystem root、package root、親repository rootそのものを拒否する。
5. data directory内に `.git` metadataがあり、`git rev-parse --show-toplevel` が解決先と一致することを確認する。
6. `githubRepository` と `expectedRemoteUrl` をcredential-free GitHub HTTPS URLへ正規化し、同じ
   owner/repositoryを指すことを確認する。

環境変数はtestや代替checkout用の任意overrideである。通常利用はversioned configだけで動作する。
config/envへrepository credential、GitHub token、answer dataを置かない。

## Identity interface

runtimeは次のread-only callから必要fieldだけを受け取る。

```powershell
gh api user --jq '{id: .id, login: .login}'
```

`gh auth status` はsetup/troubleshootingで人が認証状態を確認するために使えるが、runtime identity
resolutionの必須subprocessではない。

実装はshell command stringを組み立てず、executableとargument arrayを分けて起動する。
`id` はpositive base-10 integerとして検証した後もstringで保持する。`login` はGitHub loginの
syntaxを検証するが、branch/path/authorizationには使わない。

identity overrideを受け付けない。`gh auth token`、credential file読取、token echoは行わない。
GitHub CLIのexit code、empty response、unexpected JSONはidentity failureとし、write前に停止する。
runtimeは `gh api user` が選んだactive accountを本人とするため、利用者はsetup時の
`gh auth status` で意図したaccountを確認する。違う場合は `gh auth switch` でactive accountを
切り替えてからlocal surveyを再実行する。runtimeは複数accountから独自に選択しない。

## Private repository guard

submoduleのconfigured fetch/push remoteを特定し、configと同じGitHub `nameWithOwner` とvisibilityを
GitHub APIで確認する。
期待するremoteがない、GitHub repositoryとして解決できない、visibilityが `PRIVATE` でない、
確認APIが失敗した、remote URLへinline credentialが入っている、という場合はfail closedとする。

private確認をlocal configのflagだけで代用しない。`--save-only` も将来の誤publishを防ぐため同じguardを通す。
repositoryをprivateへ変更する操作はCLIの権限外である。

## Lock protocol

lockの粒度はresolved data directory全体とする。branch checkoutからwrite、stage、commit、push、
postcondition確認まで同じexclusive lockを保持する。identity別lockでは、同じsubmodule worktreeの
branch切替が競合するため不十分である。

lock pathはsubmodule repositoryで
`git rev-parse --git-path voluptas-survey.lock` を実行して解決する。Git metadata directory内の
`voluptas-survey.lock` をmode `0600`、exclusive create (`wx`) でopenし、file descriptorの取得を
lock acquisitionとする。lock fileへbodyを書かないため、token、identity、回答、input pathを残さない。
Git metadata内なのでworking treeのstage候補にもならない。

lockが既に存在する場合は直ちに競合として扱い、branch操作やwriteを開始しない。normal return、
validation failure、Git failureでは `finally` 相当でdescriptorをcloseしてlock fileをunlinkする。
releaseに失敗した場合もsuccessとして隠さない。

process crash後のlockは自動reclaimしない。operatorが他のlocal survey processが動いていないことを確認し、
`git rev-parse --git-path voluptas-survey.lock` が示すexact pathだけを手動削除する。ageだけでlockを
消さず、CLI自身が広いdirectoryをcleanしない。

## Repository preflight

local本人branchを変更する前に次を確認する。

- staged/unstaged/untracked pathがない、または今回のcanonical 2 pathだけである。
- repository top-levelがresolved data directoryと一致する。
- fetch URLとpush URLの双方がcredential-freeなexpected private repository URLと一致する。
- definition/responseの各ancestor directoryがrepository real path内の通常directoryであり、
  symbolic linkやWindows junctionを経由しない。

別人response、unknown temporary file、無関係な変更を自動stash、clean、reset、deleteしない。
preflight failureとしてpathだけを報告し、人による確認を求める。file contentは表示しない。

## Branch state machine

target refはexactly `refs/heads/responses/github-<id>` である。

```text
lock acquired
  ├─ --save-only
  │    └─ create/switch local responses/github-<id> from local trusted base
  │         └─ render + atomic writes ─► leave unstaged files, success
  │
  └─ publish
       └─ fetch target + trusted base
            ├─ fetch failed ────────────────────────────► fail, no write
            └─ remote branch exists?
                 ├─ yes ─► checkout tracking branch ─► fast-forward only
                 │                                     └─ divergence ► fail
                 └─ no  ─► create from trusted base
                              └─ render + atomic writes
                                   └─ exact stage ─► commit if changed
                                                        └─ non-force push
                                                             └─ rejection ► fail
```

`--save-only` はnetwork fetchを行わず、existing local本人branchへswitchするか、local trusted baseから
本人branchを作る。どちらの場合も `main` 上ではwriteしない。publish modeのfetchはtarget branchと
trusted baseだけを更新してよい。既存remote branchをlocal branchへ取り込む時は
fast-forward onlyとする。同じGitHub accountが別端末から更新してdivergeした場合、回答を自動merge、
rebase、force pushしない。remote branchがまだなければ、private repositoryのconfigured base refから
作成する。configured base `main` はdirectoryとOKF metadataの非センシティブなbootstrap skeletonだけを
含み、回答や完全な回答時definitionを含めない。CLIは生成した完全なdefinitionと本人responseを
target本人branchへ初めて導入する。

branch名はvalidated numeric IDからコードで構築し、user inputをrefへ連結しない。
`git check-ref-format --branch` 相当の検証も通す。

## Atomic file write

definitionとresponseをmemory上で完全にrender/validateしてからfilesystemへ触る。各canonical fileごとに、
同じdirectoryへ予測困難なtemporary nameで新規作成し、UTF-8 BOMなし・LF・末尾改行ありで全bytesを書き、
close後にcanonical pathへatomic renameする。

- temporary fileを追記再利用しない。
- content write前にdefinition/response双方のparent pathをpreflightする。
- canonical directoryを作る前後とrename直前に、real pathがdata root内でlink/junctionを経由しないことを再確認する。
- write/close/renameのerrorを無視しない。
- temporary pathをstage対象にしない。
- rename完了前は既存canonical fileを正本として維持する。
- 2 fileの公開上のtransaction boundaryはGit commitとする。

`--save-only` はcommit transactionを持たないため、CLIは両fileの置換が完了した時だけ成功を返す。
definitionとresponseは別pathなので2 file全体を一つのfilesystem renameにはできない。2つ目のwriteが
失敗した場合、1つ目だけが新しい可能性があるためsuccessとせず、commit/pushも行わない。deterministicな
同じcommandの再実行でpairを修復し、pathを示して確認を要求する。回答内容は診断へ出さない。

## Exact-path staging

canonical relative pathは次の2つだけである。

```text
surveys/gamer-preferences.md
responses/github-<id>/gamer-preferences.md
```

実装はvalidation済みcanonical pathをargument arrayで個別に渡し、概念上次の操作だけを行う。

```text
git add -- surveys/gamer-preferences.md responses/github-<id>/gamer-preferences.md
git diff --cached --quiet --exit-code -- surveys/gamer-preferences.md responses/github-<id>/gamer-preferences.md
git -c user.name=<login> -c user.email=<id>+<login>@users.noreply.github.com commit --only --message "Update local survey response" -- surveys/gamer-preferences.md responses/github-<id>/gamer-preferences.md
git push --set-upstream origin HEAD:refs/heads/responses/github-<id>
```

`git add .`、`git add -A`、glob、shell expansionを禁止する。pathは固定survey IDとvalidated numeric
GitHub IDだけから構築し、Git pathspec metacharacterを許さない。stage前後のporcelain statusを検査し、
expected set以外が一つでもあればcommitせず失敗する。no diffならempty commitを作らないが、publish modeは
explicit本人branchへのpushを実行してremote到達性を確認し、正常な `unchanged` として報告する。

commit messageへnumeric ID、login、answer、自由記述、input filenameを含めない。commit単位のauthor
overrideにはGitHub loginとGitHub noreply address `<id>+<login>@users.noreply.github.com` を使ってよい。
これはglobal/local Git configを変更せず、回答者のGitHub identityにcommitを可読に紐付けるためである。

## Push and postconditions

push先は検証済みremote、refspecは `HEAD:refs/heads/responses/github-<id>` に固定する。
`--force`、`--force-with-lease`、全branch push、tag pushを行わない。current branchがtargetと一致する
ことをpush前に確認する。push rejectionはfailureであり、
local commitを削除・resetせず、remote更新を取得して人が解決できる状態を保つ。

successを返す前に次を検証する。

- current branchがtarget branchである。
- commitのchanged path集合がexpected setのsubsetであり、他pathを含まない。
- remote target refがpushed commitを指す。
- indexにunexpected staged entryがない。

親Voluptas repositoryの `.gitmodules` はdata submoduleに `ignore = all` を指定し、submodule HEADの
移動を通常の親 `status` / diff対象から除外する。local survey CLIは親repositoryで `git add`、commit、
pushを行わず、親gitlinkをresponse commitへ更新しない。`ignore = all` は秘密化機構ではなく誤stage防止の
追加guardであり、private repositoryのaccess controlを置き換えない。

## Logs and errors

許可するoperation outputは次に限定する。

- operation stage名
- survey ID/version
- canonical relative path
- redacted remote repository名
- branch名
- commit SHA
- success/no-op/failure reason

禁止するoutputは次のとおりである。

- answer value、answer object、freetext
- input JSON fileのcontent
- GitHub token、credential、authorization header
- GitHub API raw response
- generated OKF file全体
- command lineへ埋め込まれたsecret

child processのstdout/stderrを無条件にrelayしない。Git/GitHub CLI errorはsecretを含まないことを確認して
要約し、必要ならexit codeとoperationだけを返す。

## 保持と削除

### Current responseの保持

current treeでは、1 GitHub numeric ID・1 surveyにつきresponse fileを一つ保持する。再回答は同じpathを
置換して新しいcommitを作る。governance ownerは `LUDIARS/Voluptas-Data` repository administratorsである。
response branchは最終submissionから最大365日、または本人削除依頼の早い方まで保持する。administratorsは
quarterlyにaccess権、branchの最終submission、365日超過、未処理削除依頼をreviewする。
response branchを `main` へmergeしない。

### 通常削除

v0.1の通常削除は、対象numeric IDを本人確認した後、remoteの
`responses/github-<id>` branchを削除し、対応するlocal branch/worktreeも削除する。本人branchには
その人の完全なdefinition/responseだけがあるため、他人のbranchやdata `main` を変更しない。
この操作はreachable current branchの削除であり、過去Git object、clone、backupからの消去ではない。
本人削除依頼は受付から30日以内に本人確認と通常branch削除を完了する。通常 `survey:local` CLIには
削除optionを設けず、repository administratorsの承認済み管理手順で行う。

### 履歴消去

本人要求やincidentにより過去回答も消す場合は、repository管理者が別runbookで次を扱う。

1. numeric IDと対象survey/pathを本人確認する。
2. 全branch/tag/refと派生exportを探索する。
3. 承認済みhistory rewriteを実施し、該当refを更新・削除する。
4. organization ownerへescalateし、GitHub Supportとbackup手順でcache/dangling objectの扱いを確認する。
5. clone、backup、analysis projectionの保持期限を適用する。
6. 回答値を含まない監査記録へ完了範囲と残存範囲を記録する。

branch削除やforce pushだけで完全消去を保証しない。通常CLIはhistory rewriteを実行しない。

## PostgreSQL compatibility boundary

このGit workflowはPostgreSQL transactionを開始せず、`surveys` / `survey_responses` tableへ書かない。
将来のcompatibility importerはprivate data commitを明示inputとし、同じcommitから再実行できるようにする。
DB write成功をGit push成功条件へ含めず、GitとDBの分散transactionを作らない。
