---
type: interface
title: "Corpus survey backend"
description: "Corpus/GLAB frontend panelが利用するVoluptas backend API、認証、Cernere project WebSocket契約。"
service: voluptas
domain: survey
tags:
  - rest
  - websocket
  - corpus
  - cernere
status: implemented
related:
  - ../plan/corpus-survey-integration.md
  - ../feature/corpus-survey-integration.md
  - ../setup/corpus-survey-integration.md
  - ../test/corpus-survey-integration.md
  - ../data/data-schema.md
updated: 2026-07-24
---

# Corpus survey backend

## Service manifest

`GET /.well-known/corpus-service.json`は認証不要で、次を宣言する。

- `service`: `volputas`
- `corpusApi`: `1`
- `health`: `/health`
- `auth`: `cernere-project-token`
- `cernereProjectKey`: `volputas`
- `panels`: `[]`（frontendはGLAB plugin packが所有）
- `data`: 下記3 endpoint

## REST API

base path: `/api/v1/integrations/glab/surveys`

すべて`Authorization: Bearer <Cernere user-for-project PASETO>`を要求する。
すべて`Cache-Control: private, no-store`を返す。通常のrate limit keyは検証済みCernere `sub`であり、
Corpus connectorの共有送信元IPを本人性や個人利用枠に使わない。認証前には別途、通常枠の10倍の
粗い送信元IP abuse上限を適用する。この上限と`no-store` headerはbody parserより前に適用し、
malformed / oversized JSONでも迂回させない。

### List

`GET /?category=game_review|game_survey|peer_question`

```json
{
  "ok": true,
  "data": [
    {
      "id": "uuid",
      "title": "ゲームレビュー投稿",
      "description": "プレイしたゲームを定性評価します。",
      "questions": [],
      "category": "game_review",
      "createdAt": "2026-07-24T00:00:00.000Z",
      "answered": false
    }
  ]
}
```

### Detail

`GET /:surveyId`

```json
{
  "ok": true,
  "data": {
    "survey": {},
    "response": {
      "surveyId": "uuid",
      "answers": { "overall_rating": 4 },
      "submittedAt": "2026-07-24T00:00:00.000Z"
    }
  }
}
```

未回答時の`response`は`null`。

### Save response

`PUT /:surveyId/response`

```json
{
  "answers": {
    "game_title": "架空ゲーム",
    "overall_rating": 4
  }
}
```

更新は同じCernere user/survey組を置換する。question IDごとにexactly oneのTEXTまたはINTEGERへ
正規化する。INTEGERはPostgreSQL int32範囲、TEXTは4,000文字以内でU+0000とunpaired
UTF-16 surrogateを拒否する。

## Project-token validation

- Cernere `/.well-known/cernere-public-key`のEd25519公開鍵だけを利用する。
- `VOLPUTAS_AUDIENCE`と`aud`を完全一致検証する。
- `kind=user_for_project`、`projectKey=volputas`、UUID `sub`を要求する。
- 公開鍵は最大10分cacheし、同時refreshはsingle-flightにする。
- `CERNERE_BASE_URL`はHTTPSを必須とし、HTTPは明示的なloopback hostだけ許可する。
- key rotation対応として、cache鍵で署名が一致しない場合だけ強制refreshして再検証する。
  claim不一致・期限切れ・malformed tokenではrefreshしない。強制refreshは30秒に1回までとする。
- HS256、Voluptas独自JWT、無認証へのfallbackは行わない。

## Cernere project WebSocket

Voluptas backendはExcubitorが起動時注入するproject credentialで
`POST /api/auth/login` (`grant_type=project_credentials`)を行い、返されたtokenを
`Sec-WebSocket-Protocol: bearer, <token>`として`/ws/project`へ接続する。

使用command:

- `volputas_survey.list_response_statuses`
- `volputas_survey.get_response`
- `volputas_survey.save_response`

requestは`request_id`で相関し、各requestのtimeoutでは対象requestのみを、socket closeまたは
protocol errorでは同じconnection generationのpending requestをすべて明示的に失敗させる。
shutdownは進行中loginをabortし、対象socketのcloseを待ち、shutdown後の
再接続を拒否する。古いsocketを含む全connectionを追跡し、close handshakeが完了しない場合は
timeout後にterminateする。古いsocketのeventは新しいgenerationのpending requestへ作用しない。
受信上限はHTTP 1 MiB bodyをresponse envelope化できる2 MiBとし、status照会はCernere契約の
500 survey ID単位へtransport層で分割する。
tokenとcredentialはprocess memory以外へ保存しない。
