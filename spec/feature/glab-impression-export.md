# 遊んだ感想の書き出し (SPEC-GLAB-IMPRESSION-EXPORT)

> 状態: 実装済み (2026-10-07)。利用者は Discutere (Di) のユーザーの声の収集。

## 目的

Discutere はディスカッションペーパーと議論の材料に「ユーザーの声」を使う。ゲームがリリース済みなら
Steam のレビューを使うが、Steam に無いゲーム (未リリース・テスト中) は、GLAB で集めた
「遊んだ感想」を Voluptas から受け取って使う。

## 口

`GET /api/personas/impressions?game=<ゲーム名>&limit=<1-200, 既定 50>`

- 認証: ペルソナ書き出し (`/api/personas/export`) と同じサービス間認証
  (Cernere service token、scope `persona-export:read`。移行期間は固定トークンも受ける)。
- `game` はゲーム名の部分一致で絞り込む (NFKC・大文字小文字・空白を無視、双方向)。
  略称と正式名のどちらで指定されても拾うため。省略時は全ゲーム。
- 応答: `{ ok: true, data: { impressions: [{ id, gameTitle, recommend, polarity, comment, createdAt }] } }`
  (`Cache-Control: private, no-store`)。

## 個人データ

- 公開範囲が `community` の感想だけを返す。`private` は返さない。本文が空の感想も返さない。
- 書き手の情報 (名前・仮名・userId・displayName・glabProjectId) は**一切含めない**。
  Discutere は匿名 workspace で声を保管するため、書き手を識別する値を渡す必要が無い。

## 実装

- `src/services/glabReviewService.js` の `listImpressions` (最大 20 ページ × 100 件を走査し、全件走査はしない)
- `src/routes/impressionExport.js` (`app.js` で `/api/personas/impressions` に結線)

## Discutere への自動送信 (push)

> 状態: 実装済み (2026-10-13)。Actio タスク: actio:a174d15e-1505-4bed-a790-cccb3bb8d6fa

Voluptas は匿名性を担保した上で Discutere へ感想を提供する義務がある。Discutere は Cernere 無しでも
単独起動するため (Di PR #2805)、上の取りに行く口 (pull) に頼らず、Voluptas から定期的に送る (push) 経路を正とする。
受け手は Discutere の `POST /api/persona-bridge/impressions` (Di PR #2807)。

- 送り先: `config.discuterePersonaBridge.baseUrl` (`DISCUTERE_PERSONA_BRIDGE_URL`) + `api/persona-bridge/impressions`。
  URL は `normalizeBridgeBaseUrl` で検証する (HTTPS か数値 loopback HTTP のみ)。
- 認証: persona import / 議論開始と同じ `discuterePersonaBridgeBearer()`
  (Cernere service token aud=discutere・scope `persona-bridge:write` を優先し、発行失敗時のみ固定トークン `DISCUTERE_PERSONA_BRIDGE_TOKEN`)。
- 本文: `{ "impressions": [{ id, gameTitle, recommend, polarity, comment, createdAt }] }`、1 回最大 200 件。
  中身は `listImpressions({ limit: 200 })` (community の感想のみ) から、送る直前に 6 項目だけを取り出して組み立て直す (allowlist)。
  書き手の情報 (userId / pseudoId / displayName / Cernere subject / glabProjectId) は載せない。
- `Content-Type: application/json`、`redirect: error`、タイムアウト 15 秒。
- 1 回の実行: 送り先か bearer が無ければ送らない。このプロセスで送信済みの id と 0 件は送らない。
  成功した id だけを送信済みに加え、件数を 1 行ログに出す (token・本文は出さない)。
  到達不可 / 401 / 403 / 5xx は 1 行 warn して例外を投げず、次回同じ id を再送する。
  送信済みはメモリだけで持ち、再起動後の再送は Discutere 側の id dedup で吸収する。
- 定期実行: `sessionMaintenance` と同じ形 (多重実行防止・`setInterval` + `unref`・起動直後に 1 回)。`stop()` で止める。
  HASTER の公開テストモード (`config.haster.enabled`) では動かさない。

| env | 既定 | 意味 |
|---|---|---|
| `DISCUTERE_IMPRESSION_PUSH_ENABLED` | `true` | `'false'` のときだけ止める (提供は義務なので既定で動かす) |
| `DISCUTERE_IMPRESSION_PUSH_INTERVAL_MINUTES` | `15` | 送信間隔 (分)。1〜1440 にクランプ |

実装:

- `src/services/discutereImpressionPusher.js` (`toAnonymousImpression` / `pushPendingImpressions` / `createDiscutereImpressionPusher` / `startDiscutereImpressionPush`)
- `src/config/discutereImpressionPush.js` (`config.discutereImpressionPush`)
- `src/app.js` の `start()` / `stop()` で起動・停止
