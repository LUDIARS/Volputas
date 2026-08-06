# Discutere 議論ログ還流

## 前提

- Volputas ユーザーが Discord OIDC で認証済みであること
- Settings で「自分の Discutere / Discord 発言をペルソナ分析に取り込む」を明示的に有効化すること
- Volputas backend に次を設定すること

```dotenv
DISCUTERE_PERSONA_BRIDGE_URL=https://discutere.example
DISCUTERE_PERSONA_BRIDGE_TOKEN=<dedicated bearer token>
DISCUTERE_PERSONA_BRIDGE_ASSERTION_PRIVATE_KEY=<Ed25519 PKCS8 DER base64url>
```

Di には対応する Ed25519 公開鍵 (SPKI DER base64url) を
`DISCUTERE_PERSONA_BRIDGE_ASSERTION_PUBLIC_KEY` として設定する。Bearer token と署名鍵は
別の secret として管理する。

ローカル HTTP を使う場合、URL は数値 loopback (`127.0.0.1` または `::1`) に限る。
ポートは Excubitor catalog のサービス設定から環境変数へ渡し、コードやこの資料には固定しない。

## 取込

認証済みユーザーが Settings の「Di 議論ログを今すぐ取込」を実行すると、
Volputas は次のユーザー API を呼ぶ。

```text
POST /api/v1/profile-data/discussion-voices/sync
Authorization: Bearer <Volputas user access token>
```

backend は同意と OIDC 検証済み Discord identity を再確認してから、専用 project token と、
その Discord ID に束縛した短期・一回限りの Ed25519 署名 assertion で Discutere D4 の
`GET /api/persona-bridge/utterances` を pull する。応答の opaque `nextCursor` はページング中だけ
保持し、ページごとに新しい assertion を発行する。保存対象は本人の human 発話本文、発話日時、
および内容から作るローカル重複排除 hash のみで、Discord ID と Di 内部 source ID は Cernere
evidence へ複製しない。再取込は発話日時で増分取得し、ローカル hash で重複排除する。

以前にクライアント指定で作られた identity は `verified_at` が空のため利用できない。
Discord OIDC で再認証すると、その identity が検証済みになる。明示同意を解除した後は
同期 API は 403 で失敗し、Discord identity を解除すると同意も自動的に off になる。

## Contract clauses

### SPEC-DISCUSSION-RETURN-SYNC

`POST /api/v1/profile-data/discussion-voices/sync` は通常の Voluptas user 認証後にだけ利用できる。
取込対象は認証ユーザーに紐づく検証済み Discord OIDC identity から解決し、request で任意の
Discord ID を受け取らない。同意が無効なら Di へ接続せず、identity unlink 時は同意も無効化する。

### SPEC-DISCUSSION-RETURN-ASSERTION

各 bridge pull は専用 Bearer token と別に、正確な `x-discutere-persona-assertion` header で
Ed25519 assertion を送る。形式は
`base64url(UTF-8 JSON payload).base64url(Ed25519 signature over the payload segment)` とし、payload は
`authorId`、`aud=discutere-persona-bridge`、発行から2分以内の Unix秒 `exp`、暗号学的にランダムな
`jti` だけを含む。秘密鍵は Ed25519 PKCS8 DER base64url とし、不在・不正なら接続前に拒否する。
bridge URL は HTTPS（または数値 loopback の HTTP）を直接利用し、redirect は追従しない。

### SPEC-DISCUSSION-RETURN-PAGINATION

初回は保存済み discussion evidence の最新 `occurredAt` を `since` として送り、以後は Di が返す
opaque `nextCursor` だけで最大100 pageを追う。page ごとに新しい assertion を発行し、cursor の
反復、空文字列、512文字超、または文字列以外は fail closed とする。cursor の内容は解釈しない。
Di 内部 ID と Discord ID は保存せず、`createdAt` と本文から
得る SHA-256 sourceRef で旧 evidence、同一 batch、再同期を重複排除する。
