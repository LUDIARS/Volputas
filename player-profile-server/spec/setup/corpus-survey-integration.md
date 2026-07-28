---
type: setup
title: "Corpus survey integration setup"
description: "Excubitor管理下でVoluptas backendをCorpus/GLABへ接続する設定。"
service: voluptas
domain: survey
tags:
  - setup
  - excubitor
  - cernere
status: implemented
related:
  - ../plan/corpus-survey-integration.md
  - ../feature/corpus-survey-integration.md
  - ../interface/corpus-survey-backend.md
  - ../test/corpus-survey-integration.md
updated: 2026-07-24
---

# Corpus survey integration setup

## Runtime ownership

サービス起動・再起動はExcubitorから行う。Voluptas worktree、複製folder、直接の
`npm run dev`から起動しない。起動テスト前後は`cc-test`に従いConcordiaへclaim/releaseする。

## Settings

| name | source | secret | purpose |
|---|---|---:|---|
| `CERNERE_BASE_URL` | Excubitor topology | no | Cernere REST/WS base URL |
| `VOLPUTAS_AUDIENCE` | Excubitor service URL | no | PASETO `aud`の完全一致値 |
| `CERNERE_PROJECT_CLIENT_ID` | Excubitor launch credential | yes | Voluptas project login |
| `CERNERE_PROJECT_CLIENT_SECRET` | Excubitor launch credential | yes | Voluptas project login |
| `VOLPUTAS_DATABASE_URL` | Infisical | yes | Voluptas PostgreSQL |

project credentialは`excubitor.catalog.yaml`の`cernere_launch_credentials`から起動ごとに注入される。
repository、`.env`、logへ実値を保存しない。

## Frontend

Corpus用frontendはGLAB repositoryの`plugins/volputas/`でbuildされる。Voluptas backendの
build/startはVoluptas standalone React packageをbuildまたは配信しない。

GLABはExcubitor topologyから`VOLPUTAS_URL`を受け取り、未設定時だけ明示的なdegraded panelを
表示する。

## Migration

Voluptas backendの通常migration runnerで`009_corpus_survey_catalog.sql`を適用する。
Excubitorが実行する`npm run dev`の`predev`（production `npm start`では`prestart`）がlisten前に
runnerを呼び、失敗時はbackendを起動しない。既存column/tableは削除しない。

過去の実験migrationが`visible_to_glab DEFAULT true`を作成済みでも、009はdefaultと既存行を
いったんfalseへ収束させ、同migrationで明示したseedだけを公開する。

この収束は**初回適用時のみ**行う。009は`_migrations`台帳に自身の適用記録があるかを参照し、
記録済みなら一括opt-outとseedの公開引き上げをskipする。seedのupsertも`ON CONFLICT`の更新対象を
定義列（title/description/questions/category）に限定し、`visible_to_glab`と`is_active`は
運用値を保持する。したがって台帳適用済みの環境へpsql等で009を手動再適用しても、
公開中のsurveyが非公開へ巻き戻ることはない。

台帳適用済み環境では通常のrunnerが009をskipするため、この修正の適用に再migrationは不要
（schema変更を伴わない防御的修正）。
