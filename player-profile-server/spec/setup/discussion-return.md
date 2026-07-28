# Discutere 議論ログ還流

## 前提

- Volputas ユーザーが Discord OIDC で認証済みであること
- Settings で「自分の Discutere / Discord 発言をペルソナ分析に取り込む」を明示的に有効化すること
- Volputas backend に次を設定すること

```dotenv
DISCUTERE_PERSONA_BRIDGE_URL=https://discutere.example
DISCUTERE_PERSONA_BRIDGE_TOKEN=<dedicated bearer token>
```

ローカル HTTP を使う場合、URL は数値 loopback (`127.0.0.1` または `::1`) に限る。
ポートは Excubitor catalog のサービス設定から環境変数へ渡し、コードやこの資料には固定しない。

## 取込

認証済みユーザーが Settings の「Di 議論ログを今すぐ取込」を実行すると、
Volputas は次のユーザー API を呼ぶ。

```text
POST /api/v1/profile-data/discussion-voices/sync
Authorization: Bearer <Volputas user access token>
```

backend は同意と OIDC 検証済み Discord identity を再確認してから、専用 project token で
Discutere D4 の `GET /api/persona-bridge/utterances` を pull する。保存対象は本人の human
発話本文、発話日時、Di の source ID のみで、Discord ID は Cernere evidence へ複製しない。
再取込は発話日時で増分取得し、source ID で重複排除する。

以前にクライアント指定で作られた identity は `verified_at` が空のため利用できない。
Discord OIDC で再認証すると、その identity が検証済みになる。明示同意を解除した後は
同期 API は 403 で失敗し、Discord identity を解除すると同意も自動的に off になる。
