# Voluptas data schema classification

| データ名 | 種類 | 権威ソース | 保存先 | 保護要否 | 保護方法 |
|---|---|---|---|---|---|
| `users` / `federated_identities` | user | Voluptas認証境界 | PostgreSQL | 必要 | 認証済み本人のみ。raw profile allowlist、token非ログ化 |
| `player_profiles` | user | 本人承認済みVoluptas profile | PostgreSQL | 必要 | 本人更新。代理claimはaccept後のみ反映 |
| `survey_responses` | user | 本人回答 | PostgreSQL | 必要 | 本人単位アクセス、分析時のみ利用 |
| `profile_delegation_grants` | user | 委任した本人 | PostgreSQL | 必要 | field scope、期限、利用上限、失効。招待tokenはhashのみ |
| `profile_claims` | user | 提案者。正本化権限は本人 | PostgreSQL | 必要 | 正本と分離、構造化allowlist、本人個別承認、処分済み生値は日次purgeで30日後削除 |
| `delegation_audit_events` | user | Voluptas | PostgreSQL | 必要 | 本人・代理人のみ参照。claim値やtokenを記録しない |
| `player_affect_profiles` | user-derived | Voluptas分析 | PostgreSQL | 必要 | 20D派生値。仮名化exportのみ |
| `play_impressions` / `impression_assets` | user | 投稿した本人 | PostgreSQL + private object storage | 必要 | 所有者認証、署名付きPUT/GET、media検査・変換、期限付き原本削除 |
| `impression_reactions` | user | 動画を見た本人 | PostgreSQL | 必要 | 所有者認証。動画内時刻、`comment/positive/negative`、本人入力本文を保持 |
| `game_beat_scripts` | master | Voluptas運用者 | PostgreSQL | 不要 | versioned controlled vocabulary |

Voluptas固有のプロフィール・委任データはサービスDBに保持する。表示名、メール、provider subjectなど
認証系個人データを委任・claimテーブルへ複製しない。DiscutereへはHMAC仮名IDと本人承認済み派生値だけを渡す。
