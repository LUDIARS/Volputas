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
