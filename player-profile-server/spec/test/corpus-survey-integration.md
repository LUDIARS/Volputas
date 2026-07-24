---
type: test
title: "Corpus survey integration test plan"
description: "Corpus frontend/backend contract、Cernere認証、survey validation、project WebSocket lifecycleを検証する。"
service: voluptas
domain: survey
tags:
  - test
  - corpus
  - cernere
status: implemented
related:
  - ../plan/corpus-survey-integration.md
  - ../feature/corpus-survey-integration.md
  - ../interface/corpus-survey-backend.md
  - ../setup/corpus-survey-integration.md
  - ../data/data-schema.md
updated: 2026-07-24
---

# Corpus survey integration test plan

## Release gate

- backend `npm test`
- standalone frontend `npm run build`
- Corpus service manifest contract test
- real Ed25519 PASETO sign/verify test
- Cernere project client fake transport test
- survey list/detail/save service test
- answer validationの正常・異常・境界test
- malformed JSONの回答値がresponse/logへ残らないtest
- 非loopback HTTP設定の拒否test
- user-subject単位rate-limit/no-store wiring test
- source-level wiring test（route mountとbackend catalogからfrontend buildが外れていること）

## Critical path

fake Voluptas catalog repositoryとfake Cernere response storeを使い、Cernere subjectで一覧取得、
detail取得、回答正規化、保存結果表示までを通す。実回答、実token、production DBは使わない。

## Authentication boundaries

- 正しいaudience/project/kind/UUID subjectだけを受理する。
- audience違い、project違い、kind違い、期限切れ、署名不正、token欠落を拒否する。
- 公開鍵取得失敗・空key setは無認証fallbackせず失敗する。
- claim不一致では鍵refreshせず、署名不一致の強制refreshを30秒に1回へ制限する。
- middleware errorへtokenを含めない。

## Input validation

- category allowlist
- survey/question schema
- required answer
- scale min/maxとPostgreSQL int32境界
- choice membership
- freetext 4,000文字境界、U+0000、unpaired surrogate
- unknown question、duplicate/unsafe question ID
- answer object以外、100問超

validation errorはquestion IDと理由だけを返し、answer valueを含めない。

## Project WebSocket lifecycle

- project login payloadと`bearer` subprotocol
- connected後のrequest/response相関
- ping/pong
- server error
- request timeout
- malformed message
- close時のpending rejection
- explicit closeでtimer/pending/socketを解放
- login中shutdownのabortとshutdown後の再接続拒否
- stale socket generationのclose/error isolation
- auth timeoutで置換された全closing socketのbounded terminate
- 1 MiB HTTP回答を包む2 MiB WS response上限
- 500件を超えるstatus requestのtransport batching

## Manual integration

Cernere側の`volputas_survey.*` commandとmigrationがmainへ反映された後、プロジェクト本体folderを
Excubitor経由で起動し、Concordia claim中にGLAB Corpus panelから架空回答で確認する。
worktreeからserviceを起動しない。
