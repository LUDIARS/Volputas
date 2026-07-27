---
type: test
title: "Local OKF survey test plan"
description: "OKF v0.1 rendering、answer validation、GitHub identity、private submodule Git workflow、atomicity、lock、privacy、compatibilityを検証する。"
service: voluptas
domain: tooling
tags:
  - test
  - okf
  - git
  - github-cli
  - concurrency
  - privacy
status: planned
related:
  - ../plan/local-okf-survey-data.md
  - ../feature/local-okf-survey.md
  - ../interface/local-survey-git-workflow.md
  - ../setup/local-okf-survey.md
  - ../data/data-schema.md
updated: 2026-07-23
---

# Local OKF survey test plan

## Purpose

local surveyがDBなしで再現可能なOKFを生成し、正しいGitHub本人branchへ安全にpublishすることを確認する。
特に、機能成功だけでなく、public remote、identity不明、concurrent実行、partial write、dirty index、
push競合で安全側に失敗し、tokenや回答が二次出力へ漏れないことをrelease gateとする。

## Test isolation rules

- automated testは実ユーザーの回答、token、private production repositoryを使わない。
- filesystem/Git testは一時working repositoryを使い、network上のfetch/push/ls-remoteは
  injected process adapterで置き換える。
- `gh` はfake executable/process adapterで置き換え、固定のtest identityとvisibilityだけを返す。
- fake identityはGitHub numeric IDに似た文字列を使うが、実accountの値を使わない。
- answer fixtureは架空値だけとし、自由記述に個人情報を入れない。
- stdout/stderr capture、commit object、lock metadataをtest終了時にprivacy scanする。
- test failureでもfixture contentをsnapshot errorやCI artifactへ全文出さない。

## Coverage status

v0.1のautomated suiteは、OKF renderer、answer/definition validation、strict UTF-8 answer file、
CLI argument/error redaction、GitHub identity/private repository guard、config cross-field binding、
process output sanitization、Git metadata lock、path containment（Windows junctionを含む）、
per-file atomic replace、offline/online branch preparation、exact-path commit、explicit refspec push、
remote commit確認、save-only/publish workflow orchestrationをcoverする。

次はrepository governanceまたはexternal systemを伴うためmanual/operational release checkとして残す:
private production remoteを使うend-to-end確認、親 `.gitmodules` / gitlink invariance、365日retentionと
30日削除SLA、quarterly review、GitHub Support/backupへの完全消去escalation。保存済みOKF reader/importerは
v0.1非対象であり、そのround-trip testもdeferredである。

## Automated: OKF v0.1 renderer

### Survey Definition

同じdefinition inputを複数回renderし、byte-for-byte同一であることを確認する。

- UTF-8 BOMなし、LF、末尾改行あり。
- YAML frontmatterの順序は
  `type`, `title`, `description`, `resource`, `tags`, `okf_version`, `survey_id`, `survey_version`。
- `type` は `Survey Definition`、`okf_version` はstring `0.1`。
- `survey_id` は `gamer-preferences`、`survey_version` はstring `1.0.0`。
- authoritative JSON fenceは一つだけで、parse結果のkeyは決定順に
  `description`, `kind`, `okf_version`, `questions`, `survey_id`, `survey_version`, `title`。
- `kind` は `voluptas.survey_definition`。
- JSONとfrontmatterの `survey_id` / `survey_version` が一致する。
- questionのorder、ID、type、optionを欠落・変形させない。
- YAML delimiter、backtick、Unicode、改行を含むtitle/descriptionでもdocument境界を壊さない。

### Survey Response

- frontmatterはdefinition共通fieldに加えて
  `timestamp`, `github_user_id`, `github_login`, `producer_revision` を持つ。
- `github_user_id` はquoteされた10進stringとしてserializeされ、JavaScript numberへ変換されない。
- `timestamp` はUTC ISO 8601、milliseconds付きcanonical formである。
- `producer_revision` はlowercase Git object IDである。
- Markdown bodyはdefinitionへのbundle-absolute link `/surveys/gamer-preferences.md` を持ち、
  `## Authoritative JSON` の直後に
  dynamically sized JSON fenceを一つ持つ。
- authoritative JSONの決定順keyは
  `answers`, `github_identity`, `kind`, `okf_version`, `producer_revision`, `submitted_at`,
  `survey_definition`, `survey_id`, `survey_version`。
- `kind` は `voluptas.survey_response`。
- `github_identity` はexactly `{ id: string, login: string }`。
- `survey_definition` はexactly `/surveys/gamer-preferences.md`。
- frontmatter `timestamp` とJSON `submitted_at`、identity、revision、survey versionが一致する。
- answersを変えずに同じtimestamp/revision/identityでrenderした結果はbyte-for-byte同一である。

### Deferred reader tests

保存済みOKFをtyped valueへ戻すapplication parser/importerはv0.1では未実装であり、現行release gateに
含めない。将来readerを追加するtaskでは、unknown version/kind、frontmatterとJSONの不一致、
authoritative JSON fenceの欠落・重複、malformed YAML/JSON、unsafe Unicodeを拒否するtestを追加する。
extra proseへ埋め込んだ値をauthoritative answerとして読んではならない。

## Automated: answer validation

definitionの全question typeについてvalid/invalid境界をtable-driven testにする。

| Case | Expected |
|---|---|
| question ID集合が完全一致 | pass |
| required questionが1つ欠落 | fail、messageはIDだけ |
| unknown questionを1つ追加 | fail、valueはmessageへ出さない |
| `choice` stringが定義済みoption | pass |
| unknown choice | fail |
| choiceがstring以外 | fail |
| freetextが1または2,000 code points | pass |
| freetextがemptyまたは2,001 code points | fail |
| Unicode astral characterを含む | code unitでなくcode pointとしてcount |
| unsafe control/unpaired surrogate | fail |
| `__proto__` 等のunexpected key | fail |
| definitionに `choice` / `freetext` 以外のtype | fail |

全validation failureについて、captured error/stdout/stderrに元answer valueとanswer objectのserialized textが
含まれないことをassertする。

## Automated: config and path safety

- defaultでは `config/local-survey.json` の `private/survey-data` をpackage root基準で解決する。
- current working directoryを変えても同じcanonical directoryになる。
- `VOLUPTAS_SURVEY_DATA_DIR` がある時だけdirectoryをoverrideする。
- empty overrideはdefaultとして扱う。
- absolute/relative test directoryを正規化できる。
- filesystem root、親repository root、non-Git directoryはexpected repository top-level/remote検証で拒否する。
- top-level `schemaVersion: 1` だけを受け入れ、missing、string `"1"`、numeric `2` を拒否する。
- required key、GitHub repository、remote、base branch、prefixのmissing・wrong typeを拒否する。
- `githubRepository` と `expectedRemoteUrl` が別repositoryを指すconfigを拒否する。
- config/envへtokenらしいfieldを追加してもcredentialとして利用しない。
- response pathはnumeric IDから
  `responses/github-<id>/gamer-preferences.md` だけを生成する。
- negative、zero、decimal、exponent、whitespace、slashを含むIDを拒否する。

## Automated: GitHub identity and private guard

fake GitHub CLI process adapterで次を検証する。

- valid `{ id, login }` を返すとIDをstringとして保持する。
- 大きなnumeric IDでもJavaScript numberへ変換して精度を失わない。
- 同じID・異なるloginは同じbranch/pathになり、metadataだけが更新される。
- 同じlogin・異なるIDは別branch/pathになる。
- missing/invalid ID、missing/invalid login、malformed JSON、non-zero exitでwrite前に失敗する。
- identity override option/configを受け付けない。
- `gh auth token` が一度もinvocationされない。
- remote visibilityが `PRIVATE` の時だけ続行する。
- `PUBLIC`、`INTERNAL`、missing visibility、API failureでwrite/commit/pushしない。
- expected URLとactual remoteが違う、inline credential付きURLである場合は拒否する。

fake process adapterへ渡されたargument arrayを検査し、shell interpolationを使っていないことも確認する。

## Automated and future: atomic writer

fault injection可能なfilesystem adapterを使う。

現行automated suiteはcanonical path生成、path traversal拒否、definition/responseのwrite先、
Windows junction拒否、existing artifactのatomic replaceとtemporary file清掃をcoverする。
次のうちfailure injection項目はfuture hardeningであり、現行releaseで実施済みとは扱わない。

- parent directory作成後、same-directory temporary fileをexclusive createする。
- successful writeはcanonical fileを完全に置換し、temporary fileを残さない。
- definition/response双方のancestorをcontent write前にpreflightする。
- repository外、symbolic link、Windows junctionを経由するancestorを拒否する。
- **Future:** write途中、close、rename前のfailureでは旧canonical contentが変わらない。
- **Future:** definition rename後にresponse writeが失敗した場合はsuccessを返さず、commit/pushを行わない。
- **Future:** partial pairは同じdeterministic commandの再実行で修復できる。
- **Future:** process中断を模したtemporary fileを次回canonical recordとして読まない。
- temporary name、error、lock metadataへanswer contentを含めない。

## Automated and future: lock

現行automated suiteはexclusive acquisition、同期/非同期operationの完了までの保持、success/error時のreleaseを
coverする。次のmode/body/release-failure testはfuture hardeningである。

- 同じresolved data directoryへの最初のprocessだけがlockを取得する。
- 2 process目はbranch操作・write前に競合failureになる。
- 別data directoryのtestは相互にblockしない。
- normal success、validation failure、Git failureでlockを解放する。
- **Future:** `git rev-parse --git-path voluptas-survey.lock` のresultだけをlock pathに使う。
- **Future:** lock fileをmode `0600`、exclusive `wx` で作成する。
- existing lockを自動reclaimせず `LOCK_HELD` としてfail closedにする。
- **Future:** lock fileへbodyを書かず、token/identity/answer metadataがない。
- Git metadata内のlock fileがstatus/stage/commit setに入らない。
- **Future:** release時のclose/unlink failureをsuccessとして隠さない。

## Future: full CLI save-only integration

answer file、interactive collector、workflow orchestrationは個別にautomated test済みだが、process entry pointから
一時data repository/fake `gh` までを結ぶfull CLI integrationはfuture coverageである。

1. interactive input adapterからcomplete answersを渡す。
2. `--answers <utf8-json-file>` から同じanswersを渡す。
3. 両経路のdefinition/responseが同じtyped contentになることを確認する。
4. `--answers` にinline JSONを渡すとfilesystem pathとして扱われ、安全に失敗することを確認する。
5. `--save-only` 後にcurrent branchがlocal `responses/github-<id>` であり、canonical 2 fileだけが
   modified/untrackedで、index、HEAD commit、remote refsが不変であることを確認する。
6. `--save-only` がfetchを呼ばず、`main` へdefinition/responseを書かないことを確認する。
7. DB connection variableを設定せず、PostgreSQL processなしで完了することを確認する。

input fileがmissing、invalid UTF-8、invalid JSON、array/scalar top-level、不完全回答の場合は、canonical
file、index、HEAD、remoteを変えない。

## Automated: branch, commit, and push contract

temporary working repositoryとnetwork operation adapterを使い、fake private visibility guardを通す。

### First publish

- target branchがない状態から `responses/github-<id>` をtrusted base上に作る。
- definitionと本人responseのvalidated exact pathだけを個別argumentでstageする。
- staged path集合がexactly expected 2 pathsである。
- commit messageにanswer/login/input filenameがない。
- explicit target refへnon-force pushする。
- remote target refがlocal commitを指す。
- 親repositoryをfixtureに含める場合、`.gitmodules` の `ignore = all` が有効で、
  そのindex/HEAD/gitlinkが不変である。
- data `main` にはbootstrap skeletonだけが残り、完全なdefinition/responseが追加されない。

### Update and no-op

- remote本人branchをfast-forwardしてから既存responseを更新する。
- login renameは同じbranch/pathのmetadata updateになる。
- response changeはnew commitになる。
- byte-identical再実行はempty commitを作らず、本人branchをpushして正常 `unchanged` になる。
- `survey_version` を `1.0.0` から将来versionへ変更する場合、definitionとresponseの更新が同じcommitへ含まれる。
- target本人branchには完全なdefinitionと本人responseが同じcommitで存在する。

### Exact staging isolation

次のunrelated artifactをそれぞれ用意し、commitへ混入しない、またはpreflightで安全に失敗することを
確認する。

- 別GitHub IDのresponse
- unrelated tracked modification
- unrelated untracked file
- pre-staged file
- leftover ignored temporary artifact（canonical扱い・stage・cleanupをせず、unique temp nameで安全に継続）

`git add .` / `git add -A` / wildcardがprocess invocationに存在しないこと、commit changed pathにexpected
set以外がないことをassertする。

### Remote concurrency

- 同じremote本人branchを別cloneから先に更新すると、stale clientのpushがrejectされる。
- CLIはforce/force-with-leaseを再試行しない。
- local commitをreset/deleteせず、回答値なしのrecovery messageを返す。
- diverged branchを自動merge/rebaseしてanswerを選ばない。

### Failure injection

fetch、checkout、write、add、commit、push、postcondition checkを各段階で失敗させる。
後続の破壊的operationを行わず、documented stateを残し、lockを正しく処理することを確認する。
push failureをsuccessとして報告しない。

## Future/manual: full privacy regression

現行automated suiteはrejected answer path、malformed UTF-8 bytes、GitHub API/identity error、process argument/outputの
redactionを個別にcoverする。次のrepository-wide canary scanはfuture automationまたはmanual release checkである。

token canaryとanswer canaryを異なるunique stringでfixtureへ入れ、test後に次をscanする。

- captured stdout/stderr
- application/test log
- exception message/stackのcustom context
- process argument list
- Git metadata内のempty lock file
- Git branch/ref names
- commit subject/body
- definition file
- response file以外のworking tree files
- CI artifactとして登録されるsnapshot
- 親Voluptas repositoryのobject database、index、commit

token canaryはどこにも現れてはならない。answer canaryは当該private response fileとその意図した
Git commit blob以外に現れてはならない。validation failure caseではcommit blobにも現れない。

Git child processのraw stderrをrelayしないこと、`gh auth token` を呼ばないこともspyでassertする。

## Manual governance: retention and deletion

- 再回答後のcurrent treeには最新版responseだけがある。
- 通常削除は当該 `responses/github-<id>` remote/local branchを削除し、`main` と別人branchを維持する。
- branch削除後はcurrent reachable refからdefinition/responseを読めない。
- 過去commitからは旧responseを読めることを明示的に示し、「完全消去」と誤報しない。
- branch deletionだけではdangling/history objectが直ちに消えないことをrunbook testで確認する。
- history purge toolは通常 `survey:local` から呼ばれない。
- retention metadata/監査記録へanswer valueを入れない。
- 最終submissionから365日を超えたbranchがquarterly reviewで検出される。
- 本人削除依頼が受付から30日以内にbranch削除完了へ遷移する。
- response branchを `main` へmergeする運用を拒否する。
- 完全消去要求がorganization owner、GitHub Support、backup手順へescalateされる。

production history rewrite自体はautomated integration testで実remoteへ行わない。

## Future: PostgreSQL compatibility tests

- existing survey route/model testsは従来どおりPostgreSQL compatibility pathを検証する。
- local CLI testはDB接続をmockせず、database moduleをload/useしない。
- local publishで `surveys` / `survey_responses` rowが暗黙作成されない。
- existing PostgreSQL responseとlocal OKF responseが競合しても、CLIがDB値でOKFを上書きしない。
- 将来importerを追加するまでは、local responseが既存分析へ自動投入されないことを明示する。

## Manual release check

private test repository/test accountだけで次を確認する。

1. fresh cloneからsubmoduleを初期化する。
2. `gh` identityとprivate visibilityを確認する。
3. DBを起動せずinteractive modeを完了する。
4. generated OKFのfrontmatterとauthoritative JSON fenceがgolden renderer testと一致することを確認する。
5. expected本人branchへ2 pathだけがpushされたことをGitHub UIで確認する。
6. login変更を模したfake/manual testでnumeric ID branchが不変であることを確認する。
7. concurrent invocationを開始し、一方がlock errorになることを確認する。
8. unrelated local fileを置き、commitへ混入しないことを確認する。
9. remote branchを先行更新し、non-fast-forwardでforceしないことを確認する。
10. captured terminal outputとcommit messageにanswer/tokenがないことを確認する。

実回答をmanual release evidenceやscreenshotへ使わない。

## Current automated release gate

- `npm test` が成功する。
- OKF golden/snapshot、deterministic rendering、input validation testが成功する。
- Git publisher/workflow contract testがWindows上で成功する。
- exclusive lock、path containment、public/mismatched fetch/push remote guard、
  divergence/non-fast-forward、remote commit確認testが成功する。
- rejected answer path、malformed UTF-8、process/GitHub errorのredaction testが成功する。
- existing Voluptas integration testsが退行しない。

## Manual gate before real responses

- private test remoteで [Manual release check](#manual-release-check) を完了する。
- `LUDIARS/Voluptas-Data` administratorsがprivate visibility、access、365日retention、30日削除SLA、
  quarterly review、完全消去escalation runbookを確認する。
- parent `.gitmodules` の `ignore = all` と、response commitがparent gitlinkへ入らないことを確認する。

## Future hardening gate

- atomic writer/lockのfailure injectionをautomated化する。
- repository-wide privacy canary scanをautomated化する。
- retention/deletion governance checkをautomated化する。
- PostgreSQL compatibility regression testを追加する。
- application reader/importerを追加する場合だけOKF parse/round-trip rejection testを追加する。
