# AI プレイテスト感想の受け口 (SPEC-VO-AI-PLAYTEST-REVIEWS)

> 状態: 実装 (2026-10-15)。Actio `actio:c9464253-a17d-486a-8613-e8d12bf3a888`。送り手は Ingenium の `ingenium playtest`
> (Ingenium `spec/feature/playtest-review.md`)。

## 目的

Ingenium の LLM プレイヤーが説明書と画面だけを見て遊んだ感想 (`ai-playtest-review/1`) を、Voluptas が匿名の「AI 由来の声」として保存する。
人の書き手を持たない記録なので、人の感想 (GLAB の voices、play_impressions) とも Cernere の個人データ列とも分けて持ち、
人の統計・ペルソナ分析・Discutere への感想送信には混ぜない (neco 2026-10-15: Discutere へは渡さない)。

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

## 実装

- `player-profile-server/src/services/aiPlaytest/aiPlaytestReviewInput.js` (入力検査・allowlist)
- `player-profile-server/src/services/aiPlaytest/aiPlaytestReviewService.js` (保存・一覧・記録 ID)
- `player-profile-server/src/models/aiPlaytestReviewRepository.js` (オンライン)、`src/local/localAiPlaytestReviewStore.js` (ローカル)
- `player-profile-server/src/middleware/aiPlaytestAuth.js`、`src/routes/aiPlaytestReviews.js`、`src/app.js` / `src/localApp.js` で結線
