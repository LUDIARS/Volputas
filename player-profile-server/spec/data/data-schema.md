---
type: data
title: "Volputas data schema classification"
description: "Volputas のデータごとの権威ソース、保存先、保護境界を定義する。local回答とCorpus回答のidentity domainを分離する。"
service: volputas
domain: persistence
tags:
  - data-authority
  - survey
  - privacy
  - postgresql
  - git-clone
status: implemented
related:
  - ../plan/local-okf-survey-data.md
  - ../feature/local-okf-survey.md
  - ../interface/local-survey-git-workflow.md
  - ../plan/corpus-survey-integration.md
  - ../feature/corpus-survey-integration.md
  - ../interface/corpus-survey-backend.md
updated: 2026-07-28
---

# Volputas data schema classification

| データ名 | 種類 | 権威ソース | 保存先 | 保護要否 | 保護方法 |
|---|---|---|---|---|---|
| `users` / `federated_identities` | user | Voluptas認証境界 | PostgreSQL | 必要 | 認証済み本人のみ。raw profile allowlist、token非ログ化 |
| `player_profiles` | user | 本人承認済みVoluptas profile | PostgreSQL | 必要 | 本人更新。代理claimはaccept後のみ反映 |
| 公開アンケート定義 | master | `LUDIARS/VolputasData` (public template) → 運用者のprivateコピー main | `private/survey-data/surveys/*.json` | 不要 | public review、version固定、filenameとsurvey ID一致 |
| ローカルアンケート回答 | user | 利用者のlocal filesystem | 独立clone内のignored local-data path | 必要 | 親/子双方のgitignore、remote publish禁止、回答非ログ化 |
| Corpus公開アンケート設問 | master | Voluptas | Voluptas PostgreSQL `surveys.questions` | 保護不要 | `is_active=true`かつ`visible_to_glab=true`だけをcategory allowlistで公開 |
| Corpus回答・回答済み状態 | user | Cernereログイン中の本人 | Cernere `volputas_survey_responses` / `volputas_survey_answers` | 必要 | Cernere `sub`本人単位、Voluptas project command限定、TEXT/INTEGER正規化 |
| `survey_responses` | compatibility | 既存Voluptas server mode | Voluptas PostgreSQL | 必要 | 既存Voluptas JWT API向け。local OKF/Corpus回答の正本にはしない |
| `profile_delegation_grants` | user | 委任した本人 | PostgreSQL | 必要 | field scope、期限、利用上限、失効。招待tokenはhashのみ |
| `profile_claims` | user | 提案者。正本化権限は本人 | PostgreSQL | 必要 | 正本と分離、構造化allowlist、本人個別承認、処分済み生値は日次purgeで30日後削除 |
| `delegation_audit_events` | user | Voluptas | PostgreSQL | 必要 | 本人・代理人のみ参照。claim値やtokenを記録しない |
| `player_affect_profiles` | user-derived | Voluptas分析 | PostgreSQL | 必要 | 20D派生値。仮名化exportのみ |
| `game_beat_scripts` | master | Voluptas運用者 | PostgreSQL | 不要 | versioned controlled vocabulary |
| `steam_profiles` | user | 本人が連携したSteam公開プロフィール | PostgreSQL | 必要 | 本人単位アクセス。公開プロフィール(communityvisibilitystate=3)のみ連携許可 |
| `steam_owned_games` | user-derived | Steam Web API (GetOwnedGames) スナップショット | PostgreSQL | 必要 | 本人単位アクセス。同期のたびに全置換、ジャンル等の追加取得は行わない |
| スクリーンショット注釈 (`annotations`) | user | 注釈した本人 | local: データリポジトリ `annotations/<Name>/<id>.json` + リポジトリ外保護media / online: Cernere managed project `annotation_records` + private media storage | 必要 | 本人単位アクセス。画像は既存media制限で保護し、分析対象は明示 `momentType` とcaptionのみ。Vision解析は行わない。online列の提供はCernere migration follow-up |
| カードソート判定 (`cardsorts`) | user | 分類した本人 | local: データリポジトリ `cardsorts/<Name>/<id>.json` / online: Cernere managed project `card_sort_records` | 必要 | 本人単位アクセス。1メカニクス1判定レコードを追記し、`updatedAt` が最新の判定だけを分析に採用。online列の提供はCernere migration follow-up |
| `play_impressions` / `impression_assets` | user | 投稿した本人 | PostgreSQL + private object storage | 必要 | 所有者認証、署名付きPUT/GET、media検査・変換、期限付き原本削除 |
| `impression_reactions` | user | 動画を見た本人 | PostgreSQL | 必要 | 所有者認証。動画内時刻、`comment/positive/negative`、本人入力本文を保持 |
| `memoria_links` | user | 本人が発行したMemoria共有token | PostgreSQL | 必要 | tokenはAES-256-GCM暗号化して保存 (Steamの平文保存とは異なる — 本人の作業データへの読み取り権限そのものであるため) |
| `personality_drafts` | user-derived | Memoria性格傾向exportの計算結果 | PostgreSQL | 必要 | 承認(approve)されるまで`player_profiles`には反映されない。生テキストは含まない(集計済み数値のみ) |

## アンケート回答の権威

`LUDIARS/VolputasData` は **public な template repository** であり、アンケート定義と
匿名サンプルの配布元である。実運用ではこの template をコピーした**運用者自身の private
データリポジトリ**を作り、`config/local-survey.json` の `dataRepository.githubRepository`
でそのコピーを指す。回答が push されるのは常にこのコピーであり、CLI の private visibility
guard もコピーに対して働く (template 自体は public のままでよい)。

ローカルモードで新規に収集した回答は
利用者のlocal filesystemだけを正本とし、remote commit/pushを行わない。
親Volputasはclone directory全体をignoreし、VolputasDataも回答・体験データpathをignoreする。
PostgreSQLへ暗黙に二重書き込みしない。将来、分析用importerを追加する場合は、
明示同意と入力fingerprintを持つ再生成可能な互換投影として別途設計する。

既存の `/api/v1/surveys`、`surveys`、`survey_responses` は server mode の互換経路として残る。
既存DBを自動移行・削除せず、ローカルCLIもDB接続を要求しない。互換DBからOKFへ移す場合は、
本人同一性の変換と同意を伴う明示的な一括移行として別途設計する。

Corpus経路では、Voluptas PostgreSQLの`surveys`を設問catalogの正本、Cernereの
`volputas_survey_responses` / `volputas_survey_answers`を本人回答の正本とする。
Cernere `sub`とlocal CLIのGitHub numeric IDを自動照合せず、Corpus回答をlocal回答や
Voluptas `survey_responses`へdual-writeしない。

## 保護境界

GitHub identity は `github_user_id`（numeric ID）を安定キーとし、`github_login` は可読表示用の
スナップショットとする。login変更で別人扱いしない。GitHub token、メール、OAuth payload、
アクセストークン、回答値をログ・commit message・lock fileへ記録しない。

回答を保持する**データリポジトリ (VolputasData template のコピー) は private repository
でなければならない** (`private: true` かつ `visibility: "private"`。internal も不可)。
template である `LUDIARS/VolputasData` 自体は回答を持たないため public でよい。
個人回答の保持・削除はデータリポジトリの operator の責任とし、template の administrators は
未送信の local data を保持しない。個人データが誤commitされた場合は参照削除だけで完了とみなさず、履歴書き換え、
PR/fork/cache、clone・backupまで含めてincident手順へescalateする。

Voluptas固有のプロフィール・委任データはサービスDBに保持する。表示名、メール、provider subjectなど
認証系個人データを委任・claimテーブルへ複製しない。DiscutereへはHMAC仮名IDと本人承認済み派生値だけを渡す。
