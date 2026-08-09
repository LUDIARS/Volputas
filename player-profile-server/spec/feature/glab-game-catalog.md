---
type: feature
title: "GLAB game catalog and game-scoped surveys"
description: "GLAB向けゲームマスタ、管理者認可、ゲーム別アンケート、投稿時の正準ゲーム解決を定義する。"
service: volputas
domain: glab-player-research
tags:
  - glab
  - cernere
  - game-catalog
  - survey
  - authorization
status: implemented
related:
  - ./glab-emotion-curves.md
updated: 2026-08-09
---

# GLAB ゲームマスタとゲーム別アンケート

感想と感情曲線の「ゲーム名」は自由入力だった。同じゲームが表記ゆれのまま別物として
溜まり、GLAB の学内制作ゲームは Steam の直近プレイにも出ないためサジェストからも
選べない。ゲームの正本を Volputas に置き、管理者が登録したものから選ばせる。

設問の正本が Volputas、回答の正本が Cernere という分担は変えない。ゲームマスタも
同じ理由で Volputas に置く。GLAB は表示と投稿の面だけを持つ。

## 権限

管理操作の認可は Cernere project token の `role` クレーム (= `users.role`) だけで
決める。GLAB 側にも管理者判定 (Corpus の `adminIds`) はあるが、それは画面を出すか
どうかの判断でしかない。GLAB を迂回して Volputas を直接叩かれても書けないよう、
サーバ側はトークンのクレームで判定する (`middleware/cernereAdmin`)。

`role` が無いトークンは管理者として扱わない。GLAB の管理者に登録操作をさせるには
Cernere 側でも `admin` である必要がある。

## API

すべて Cernere project token を必要とし、応答には `Cache-Control: private, no-store`
を付与する。

### ゲームマスタ

- `GET /api/v1/integrations/glab/games`
  - 既定では `is_active = true` のゲームだけを返す。
  - `?includeInactive=true` は管理者にだけ効く。停止済みゲームを学生の投稿フォームに
    出すと、もう受け付けていないゲームへ感想が付く。
- `POST /api/v1/integrations/glab/games` (管理者)
  - `title` 必須。`team` / `platform` / `description` / `storeUrl` / `glabProjectId` は任意。
  - タイトルは大文字小文字を畳んで一意。重複は 409 (`GAME_TITLE_TAKEN`)。
  - 未知のフィールドは 400 (`INVALID_GAME_INPUT`) で弾き、黙って捨てない。
- `PATCH /api/v1/integrations/glab/games/:id` (管理者)
  - 指定したキーだけを更新する。空ボディは 400。
  - 運用停止は `isActive: false`。行は消さない (紐付いた感想と回答を失わないため)。

### ゲーム別アンケート

`surveys.game_id` がゲームへの紐付け。ゲームに紐付かない全体アンケートは NULL のまま。

- `GET /api/v1/integrations/glab/surveys?category=&gameId=`
  - `gameId` で絞り込める。未指定なら従来どおり全件。
- `POST /api/v1/integrations/glab/surveys` (管理者)
  - 設問は catalog 契約の形 (`scale` / `choice` / `freetext`) で受ける。
  - 既定は **非公開** (`visibleToGlab: false`)。内容を確認してから公開へ倒す運用。
  - 紐付け先のゲームが存在しなければ 400 (`GAME_NOT_FOUND`)。
- `PATCH /api/v1/integrations/glab/surveys/:id` (管理者)
  - 公開切替は `{"visibleToGlab": true}` の 1 フィールド更新で表せる。

入力検証は `corpus/surveyDefinitionContract` が担う。読み出し側の `surveyContract` は
保存済み行が契約に合わなければ 500 (`INVALID_SURVEY_DEFINITION`) を返す設計なので、
検証を保存前に置かないと、その 500 が保存後に初めて出る。

Voluptas 自前アンケート 3 本 (gamer-preferences / subtypes / emotions) は
`options: [{value,label}]` という別の設問形を使っており、catalog 契約とは非互換の
ままである。この API で登録する定義はすべて catalog 契約の形に限る。

## ゲーム名の解決

感想 (`voices`) と感情曲線 (`emotion-curves`) は `gameId` を任意で持つ。`gameId` が
指定されたとき、記録に焼き付く `gameTitle` はマスタの値で上書きする。フォームが
送ってきた表示名を信じると、マスタで改題しても古い名前が記録に残り集計が割れる。

停止済みゲームへの新規投稿は 400 (`GAME_INACTIVE`)。既存の記録はそのまま残る。

マスタ登録前に書かれた記録には `gameId` が無い。表示は `gameTitle` が担い、`gameId`
はゲーム単位の集計と絞り込みのために付く。

Volputas のローカル evidence 経路はゲームマスタを解決しないため、受信した `gameId` を
保存しない。カタログ ID を保持できるのは、保存前に存在・稼働確認を行う GLAB 経路だけとする。

## スキーマ

`migrations/016_game_catalog.sql`

- `games` — `title` は `lower(title)` の一意索引で表記ゆれを止める。`registered_by` は
  登録した管理者の Cernere user id で、ローカル `users` への FK は張らない
  (GLAB 経由の管理者は Volputas にローカルアカウントを持たないことがある)。
- `surveys.game_id` — `ON DELETE SET NULL`。ゲームを消しても回答済みアンケートを失わない。

`surveyContract` の行スキーマは `.strict()` なので、GLAB へ返す列を増やすときは
あちらの宣言も同時に足す。宣言漏れは 500 になる。

## Contract clauses

### SPEC-GLAB-ADMIN-AUTHORIZATION

ゲームとアンケートの作成・更新は、有効な Volputas 向け Cernere project token の
`role=admin` を持つ利用者だけに許可する。role が無い、または別の値である token は
403 とし、GLAB 側UIの管理者判定だけを認可根拠にしてはならない。

### SPEC-GLAB-GAME-CATALOG

ゲーム入力は未知フィールドを拒否し、タイトルを大文字小文字を畳んで一意に保つ。
学生向け一覧は有効なゲームだけを返し、無効ゲームを含む一覧、登録、更新は管理者に
限定する。外部ストアURLは HTTP または HTTPS の絶対URLだけを保存・返却する。

### SPEC-GLAB-GAME-SELECTION

GLAB の感想または感情曲線に `gameId` がある場合、保存前に対象ゲームの存在と稼働状態を
検査し、`gameTitle` はゲームマスタのタイトルで上書きする。不明なIDは `GAME_NOT_FOUND`、
停止中のゲームは `GAME_INACTIVE` として400で拒否する。`gameId` が無い既存・自由入力投稿は
従来どおり入力された `gameTitle` を保持する。

### SPEC-GLAB-SURVEY-CATALOG

GLAB向けアンケート定義は保存前に catalog 契約で検証し、既定では非公開とする。
ゲーム紐付けは存在するゲームだけを許可し、学生向け読取は `is_active=true` かつ
`visible_to_glab=true` の定義だけを返す。回答の正本は引き続き Cernere とする。
