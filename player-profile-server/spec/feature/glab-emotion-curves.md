---
type: feature
title: "GLAB emotion-curve evidence transport"
description: "Cernere owner単位の感情曲線、保護media、短命再生ticket、LLM評価の境界を定義する。"
service: volputas
domain: glab-player-research
tags:
  - glab
  - cernere
  - evidence
  - media
  - authorization
status: implemented
related:
  - ./glab-game-catalog.md
  - ../data/data-schema.md
updated: 2026-08-09
---

# GLAB から感情曲線を取る

感情曲線 (動画を見ながら時刻付きでスタンプを打ち、LLM に評価させる) は Volputas
自前フロントにしか口が無かった。自前フロントは Volputas のローカル JWT で動くが、
GLAB から届くのは Cernere project token だけなので、GLAB からは届かない。

GLAB 経由の口を `/api/v1/integrations/glab/evidence` に分けて生やす。認可規則
(所有チェックと媒体種別の対応) は既存経路と同じものを使う。

## ローカル user id と owner id

自前フロント経路は Volputas ローカルの `users.id` で動き、証跡ストアの内部で
Cernere の owner id へ解決している。GLAB 経路が持っているのは owner id そのもので、
ローカル `users` 行が無いこともある。

`CernereProfileEvidenceStore` の各操作に owner id を直接受ける対 (`listForOwner` /
`findForOwner` / `findMediaForOwner` / `saveMediaForOwner` / `readAnalysisForOwner`)
を用意し、ローカル id 版はそれを呼ぶ薄い包みにした。GLAB 経路は owner id 版だけを
使う。

## 手順

1. `POST /api/v1/integrations/glab/evidence/emotion-curves`
   記録を作る。`gameId` を渡すとマスタのタイトルで `gameTitle` を上書きする
   (→ `glab-game-catalog.md`)。
2. `PUT /api/v1/integrations/glab/evidence/media/videos/:recordId`
   動画を本文にそのまま入れて送る。`content-type` がそのまま媒体の型になる。
   `game-logs` も同じ口で、こちらはテキスト。
3. `POST /api/v1/integrations/glab/evidence/emotion-curves/:recordId/evaluate`
   ペルソナ解析とアップロード済みゲームログを添えて LLM に評価させ、`evaluation` を
   記録へ書き戻す。評価は外部呼び出しなので、失敗は 502 (`EVALUATION_FAILED`)。
4. `GET /api/v1/integrations/glab/evidence/media/:kind/:recordId/ticket`
   再生用の短命 URL を発行する。

`GET /api/v1/integrations/glab/evidence/emotion-curves` は自分の記録一覧。

## 動画の中継

- **本文パーサより前に載せる。** 動画は JSON ではないので、`express.json` に先を
  越されると本文が読めない。このルータだけ本文パーサの手前に置き、JSON を受ける口
  (記録作成) はルータ内で個別にパーサを通す。
- GLAB 側の中継も同じ理由でバイナリを素通しする経路が要る。既定の `proxy()` は
  本文をテキストとして読むため、動画には使えない。

## 再生チケット

`<video>` は Authorization ヘッダを付けられないので、再生だけは署名付きの短命
チケット (10 分) で認可する。これは自前フロントと同じ仕組みだが、**券面の `sub` が
別の値空間**になる。自前フロントの券はローカル user id、GLAB の券は Cernere の
owner id である。

取り違えると「別人の id を所有者として解決する」ことになるため、券に
`subjectType` (`local-user` / `cernere-owner`) を刻み、各再生口は自分の種別の券しか
受け付けない。`subjectType` を持たない券は GLAB 経路より前に発行されたローカル券と
みなす。

## 媒体と記録の対応

`services/evidenceMedia` の `MEDIA_KINDS` が正本で、`videos` と `game-logs` は
`emotion-curves` だけが持てる。スクリーンショットの券を感情曲線へ使い回すような
経路は、この表で機械的に止まる。

メタデータの書き込みに失敗したファイルは誰からも参照できないので、Cernere 側の
失敗を主エラーとして返しつつ実ファイルは片付ける。
評価へ渡すゲームログも owner 単位の `profile_media` メタデータに登録済みのものだけとし、
孤児ファイルやメタデータ不整合を評価入力として採用しない。読み込みは LLM に渡す抜粋長へ
制限し、大きなログ全体をメモリへ展開しない。

## Contract clauses

### SPEC-GLAB-EVIDENCE-OWNER-SCOPE

GLAB evidence の一覧、作成、媒体保存、評価、ticket発行は検証済み Cernere project token の
`sub` を owner ID として実行する。record と media metadata の双方がその owner に属し、かつ
`MEDIA_KINDS` が許可する record/media の組合せである場合だけ操作を許可する。owner ID は
保存・所有確認の内部キーに限り、GLAB向けrecord viewへ含めない。

### SPEC-GLAB-EVIDENCE-MEDIA-TRANSPORT

GLAB evidence ルータはバイナリ本文をJSON化せずストリームで保存する一方、全経路を
unauthenticated transport rate limit の内側に置く。認証後は Cernere owner 単位の rate limit
も適用する。不正な evidence 入力、未対応 content type、容量超過、危険なpath segmentは
内部エラーへ昇格させず400の入力エラーとして返す。

### SPEC-GLAB-EVIDENCE-MEDIA-TICKET

再生ticketは RS256署名、issuer、audience、有効期限、media kind、record ID、owner subjectを
検証する。`subjectType=cernere-owner` のticketだけをGLAB再生口で受理し、ローカルuser用ticketと
相互利用させない。ticketの対象とURLの kind/record ID が一致した後にだけmediaを返す。
