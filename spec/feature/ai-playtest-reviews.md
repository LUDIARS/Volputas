# AI プレイテスト感想の受け口 (SPEC-VO-AI-PLAYTEST-REVIEWS)

> 受信と保存は 2026-10-15 に実装。Discutere 連携は Gen5 Step 1 の方針 (2026-11-21)。
> Actio `actio:41a3f2dc-6a26-40a3-914a-1f17526e307c`、実装委託 `actio:2bbdd7fe-cb20-4f46-b3e0-000d96573dcb`。
> 送り手は Ingenium の `ingenium playtest`
> (Ingenium `spec/feature/playtest-review.md`)。

## 目的

Ingenium の LLM プレイヤーが説明書と画面だけを見て遊んだ感想 (`ai-playtest-review/1`) を、Voluptas が匿名の「AI 由来の声」として保存する。
オンラインで保存した AI 感想は Discutere に議論材料として渡す。人の書き手を持たない記録なので、
人の感想 (GLAB の voices、play_impressions)、人の統計・ペルソナ分析、Cernere の個人データ列から分離する。

## 口

| メソッド | パス | 認証 | 内容 |
|---|---|---|---|
| POST | `/api/ai-playtests/reviews` | 専用の固定トークン `VOLUPTAS_AI_PLAYTEST_TOKEN`、またはオンラインでは Cernere service token (scope `ai-playtest:write`) | 感想 1 件を保存。`Idempotency-Key` は `run_id` と同じ値。新規 201、同じ `run_id` の再送は既存の記録を 200 |
| GET | `/api/ai-playtests/reviews?game=&limit=` | オンライン: ペルソナ書き出しと同じサービス間認証。ローカル: 他のローカル API と同じく無認証 | 一覧 (新しい順、`limit` 1〜200、既定 50)。`game` は game_id の一致かゲーム名の部分一致 (NFKC・大文字小文字・空白を無視) |

応答: `{ ok: true, data: { review } }` / `{ ok: true, data: { reviews: [...] } }`、`Cache-Control: private, no-store`。
固定トークンが未設定なら POST は 503 (受け口は閉じている)。HASTER の公開テストモードでは常に未設定扱い。

## 入力 (allowlist)

`format` (= `ai-playtest-review/1`)、`source` (= `ai-autoplayer`)、`game_id`、`game_title`、`run_id`、`persona`、`engine_version`、`adapter`、
`screen` (`image` / `text`)、`ticks`、`turns`、`outcome`、`summary` (400 文字以内)、`good` / `bad` (各 1〜8 個、必須)、`confusions` (0〜8 個)、
`reflection` (1〜8 行)、`created_at`。点は `{aspect: ux|control|game, text (300 文字以内), evidence: {ticks[], shots[]}}`。

- 決めていない項目が 1 つでもあれば 400 で拒否する (最上位・点・evidence のどの階層でも)。操作した人・端末・セッションなど、
  書き手を識別できる値を紛れ込ませないため。
- 保存する記録 ID は `aipt_` + sha256(`run_id`) の先頭 24 桁 (再送で同じ ID)。

## 保存先

- オンライン: Voluptas の DB の `ai_playtest_reviews` (migration `018_ai_playtest_reviews.sql`)。`user_id` 列は無い。`run_id` は一意。
- ローカル: データリポジトリの `ai-playtests/<id>.json`。回答者名 (Git Author) のフォルダには置かない。既存のファイルは上書きしない。

## Discutere への配送 (オンライン)

- AI 専用の `POST /api/persona-bridge/ai-playtest-reviews` を使う。既存 persona-bridge のベース URL とサービス間認証
  (`persona-bridge:write`、既存の固定トークンも利用可) を共有する。人向けの `/api/persona-bridge/impressions` は従来の 6 項目のまま扱う。
- JSON 本文は `origin: "ai"`、`source: "ai-autoplayer"`、`run_id`、`game_id`、`game_title`、`summary`、`good`、`bad`、
  `confusions`、`reflection`、`played_at`。点の形式は保存時と同じ。HTTP の `Idempotency-Key` は `run_id`。
  Discutere 側は `run_id` で重複を吸収し、保存済みの再送にも `{ "ok": true, "run_id": "..." }` を 2xx で返す。
  Discutere の AI 専用受け口は別タスクの連携前提。
- `ai_playtest_reviews` 自体が配送待ちの記録を持つ。migration `019_ai_playtest_review_delivery.sql` で
  `discutere_attempted_at`、`discutere_delivered_at`、`discutere_delivery_error` を追加する。
  未送信の過去データも対象。受理応答の `run_id` を照合して配送済みにする。
  HTTP エラーや応答異常では理由をログと送信状態に記録し、未送信として再試行する。
  配送済みの行は後続の失敗で更新しない。DB 更新に失敗した場合や並行ワーカーがある場合も同じキーで再送する。
- 人向けプッシュと同じ `DISCUTERE_IMPRESSION_PUSH_ENABLED` と `DISCUTERE_IMPRESSION_PUSH_INTERVAL_MINUTES` に従う。
  オンライン起動後と各周期に、未試行および試行時刻の古い未配送を最大 25 件ずつ読む。接続先や認証の設定不足は理由をログに残す。
  ローカルモードと HASTER では配送ワーカーを起動しない。

## 実装

- `player-profile-server/src/services/aiPlaytest/aiPlaytestReviewInput.js` (入力検査・allowlist)
- `player-profile-server/src/services/aiPlaytest/aiPlaytestReviewService.js` (保存・一覧・記録 ID)
- `player-profile-server/src/models/aiPlaytestReviewRepository.js` (オンライン)、`src/local/localAiPlaytestReviewStore.js` (ローカル)
- `player-profile-server/src/services/aiPlaytest/discutereAiPlaytestClient.mjs` (AI 専用受け口への送信)、`discutereAiPlaytestDelivery.js` (配送待ちの処理)
- `player-profile-server/src/middleware/aiPlaytestAuth.js`、`src/routes/aiPlaytestReviews.js`、`src/app.js` / `src/localApp.js` で結線
