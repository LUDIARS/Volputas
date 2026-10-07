# Cernere service token への載せ替え (認証集約 P4)

Actio: `actio:cb2b3c10-4326-4b0b-a747-5be2dd987ca7`
背景: Corpus `spec/plan/auth-plane-consolidation.md` §6 の P4。Cernere 側の発行 API と
`service_scopes` は Cernere `spec/feature/service-token.md` を参照。

### SPEC-AUTH-P4-SERVICE-TOKEN

P4 の間は送り側・受け側とも **新旧両方** を扱う。固定トークンの撤去は P5 (別 PR)。
ヘッダは従来の固定トークンと同じものを使う (どちらも `Authorization: Bearer`)。

## 送り: Voluptas → Discutere persona bridge

対象は `DiscussionBridgeClient` (`GET /api/persona-bridge/utterances`) と
`DiscutereDiscussionPublisher` (`POST /api/admin/personas/import`, `POST /api/flow/start`)。

1. `CERNERE_PROJECT_CLIENT_ID` / `CERNERE_PROJECT_CLIENT_SECRET`
   (Excubitor `cernere_launch_credentials` で注入) で
   `POST {CERNERE_BASE_URL}/api/auth/service-token`
   `{client_id, client_secret, target_project_key}` を呼ぶ。
   `target_project_key` は `DISCUTERE_CERNERE_PROJECT_KEY` (既定 `discutere`)。
2. 得た token を `Authorization: Bearer <token>` で送る。persona assertion ヘッダは変更しない。
3. token は process memory にのみ保持し、`exp - 60 秒` まで再利用する。2 つのクライアントは
   同じキャッシュを共有する。
4. 発行に失敗した場合 (credentials 未設定 / 401 / 403 / 404 / ネットワーク / 不正応答) に限り、
   `DISCUTERE_PERSONA_BRIDGE_TOKEN` が設定されていればそれで送る。理由コードだけを 1 行 warn する。
   どちらも無ければ 503 (`DISCUTERE_BRIDGE_UNAVAILABLE` / `DISCUTERE_DISCUSSION_UNAVAILABLE`)。

Cernere 側では Voluptas の `service_scopes` に `persona-bridge:write` を宣言する必要がある。

## 受け: persona export (`/api/personas/*`)

`Authorization: Bearer <value>` の値で分岐する。

- `v4.public.` で始まる: Cernere service token として検証する。
  公開鍵は `/.well-known/cernere-public-key` (既存 `CernerePublicKeyProvider`)。
  `kind === "service"`、`exp`、`aud === "volputas"` (Voluptas の storage_slug)、
  scope `persona-export:read` を照合する。呼出元 (`sub`) では分岐しない。
  不正なら 401 `PERSONA_EXPORT_UNAUTHORIZED`、scope 不足なら 403 `PERSONA_EXPORT_FORBIDDEN`。
  この経路は固定トークン未設定でも使える。
- それ以外: 従来どおり `VOLUPTAS_PERSONA_EXPORT_TOKEN` と timing-safe 比較する。
  未設定なら 503、不一致・ヘッダ無しは 401。HASTER の公開固定値
  (`haster-public-persona-export-token-v1`) の扱いは変えない。

呼出元は Discutere `src/flow/voluptas-persona-client.ts` (`DISCUTERE_VOLUPTAS_EXPORT_TOKEN`)。
Cernere 側では Discutere の `service_scopes` に `persona-export:read` を宣言する必要がある。

## P5 で消すもの

- `DISCUTERE_PERSONA_BRIDGE_TOKEN` と送り側のフォールバック (`serviceBearerResolver.js`)
- `VOLUPTAS_PERSONA_EXPORT_TOKEN` と受け側の固定トークン照合 (`personaExportAuth.js`)
