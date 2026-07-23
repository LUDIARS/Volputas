---
type: data
title: "Voluptas data schema classification"
description: "Voluptas のデータごとの権威ソース、保存先、保護境界を定義する。ローカルアンケート回答は private data submodule を正本とする。"
service: voluptas
domain: persistence
tags:
  - data-authority
  - survey
  - privacy
  - postgresql
  - git-submodule
status: implemented
related:
  - ../plan/local-okf-survey-data.md
  - ../feature/local-okf-survey.md
  - ../interface/local-survey-git-workflow.md
updated: 2026-07-23
---

# Voluptas data schema classification

| データ名 | 種類 | 権威ソース | 保存先 | 保護要否 | 保護方法 |
|---|---|---|---|---|---|
| `users` / `federated_identities` | user | Voluptas認証境界 | PostgreSQL | 必要 | 認証済み本人のみ。raw profile allowlist、token非ログ化 |
| `player_profiles` | user | 本人承認済みVoluptas profile | PostgreSQL | 必要 | 本人更新。代理claimはaccept後のみ反映 |
| ローカルアンケート定義 | master | 本人branch内の OKF v0.1 definition snapshot | `private/survey-data/surveys/*.md` | 必要 | private repository、version固定、回答と同じ本人branch/commitで保存 |
| ローカルアンケート回答 | user | 回答者が生成した OKF v0.1 response | `private/survey-data/responses/github-<id>/*.md` | 必要 | GitHub numeric ID単位branch、本人の回答だけ、exact-path staging、回答非ログ化 |
| `surveys` / `survey_responses` | compatibility | 既存Voluptas server mode | PostgreSQL | 必要 | 既存API向け互換経路。ローカル回答の正本にはしない |
| `profile_delegation_grants` | user | 委任した本人 | PostgreSQL | 必要 | field scope、期限、利用上限、失効。招待tokenはhashのみ |
| `profile_claims` | user | 提案者。正本化権限は本人 | PostgreSQL | 必要 | 正本と分離、構造化allowlist、本人個別承認、処分済み生値は日次purgeで30日後削除 |
| `delegation_audit_events` | user | Voluptas | PostgreSQL | 必要 | 本人・代理人のみ参照。claim値やtokenを記録しない |
| `player_affect_profiles` | user-derived | Voluptas分析 | PostgreSQL | 必要 | 20D派生値。仮名化exportのみ |
| `game_beat_scripts` | master | Voluptas運用者 | PostgreSQL | 不要 | versioned controlled vocabulary |
| `memoria_links` | user | 本人が発行したMemoria共有token | PostgreSQL | 必要 | tokenはAES-256-GCM暗号化して保存 (Steamの平文保存とは異なる — 本人の作業データへの読み取り権限そのものであるため) |
| `personality_drafts` | user-derived | Memoria性格傾向exportの計算結果 | PostgreSQL | 必要 | 承認(approve)されるまで`player_profiles`には反映されない。生テキストは含まない(集計済み数値のみ) |

## アンケート回答の権威

ローカルモードで新規に収集した回答は、private data submodule
`player-profile-server/private/survey-data` のコミット済み OKF v0.1 ファイルを唯一の正本とする。
data repositoryの `main` は非センシティブなbootstrap skeletonだけを持ち、完全なdefinition snapshotと
responseは `responses/github-<id>` 本人branchの同じcommitに置く。親 `.gitmodules` は
`ignore = all` とし、本人branchのgitlinkをpublic parentへstage/commitしない。
PostgreSQL へ暗黙に二重書き込みしない。将来、分析用importerを追加する場合も、DB行は
submodule の `survey_id`、`survey_version`、response commit SHAを参照する再生成可能な互換投影として扱う。
同じ回答について値が競合した場合は、private data submodule のファイルを優先する。

既存の `/api/v1/surveys`、`surveys`、`survey_responses` は server mode の互換経路として残る。
既存DBを自動移行・削除せず、ローカルCLIもDB接続を要求しない。互換DBからOKFへ移す場合は、
本人同一性の変換と同意を伴う明示的な一括移行として別途設計する。

## 保護境界

GitHub identity は `github_user_id`（numeric ID）を安定キーとし、`github_login` は可読表示用の
スナップショットとする。login変更で別人扱いしない。GitHub token、メール、OAuth payload、
アクセストークン、回答値をログ・commit message・lock fileへ記録しない。

private repository であってもGit履歴は保持媒体である。v0.1の通常削除は本人確認後にremote/localの
`responses/github-<id>` branchを削除する。過去commitからも消す必要がある削除要求は、branch削除だけでは
完了とみなさず、履歴書き換え、remote上の到達不能object、clone・backupの保持期間まで含めて
organization ownerがGitHub Support/backup手順へescalateする。

governance ownerは `LUDIARS/Voluptas-Data` repository administratorsである。response branchは
最終submissionから最大365日、または本人削除依頼の早い方まで保持し、削除依頼は30日以内に処理する。
quarterlyにaccess/retentionをreviewし、response branchを `main` へmergeしない。詳細は
[local survey Git workflow](../interface/local-survey-git-workflow.md#保持と削除)を参照する。

Voluptas固有のプロフィール・委任データはサービスDBに保持する。表示名、メール、provider subjectなど
認証系個人データを委任・claimテーブルへ複製しない。DiscutereへはHMAC仮名IDと本人承認済み派生値だけを渡す。
