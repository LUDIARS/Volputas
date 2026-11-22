---
task: ludellus-play-stream
project: Voluptas
kind: 実装
created: 2026-11-21
memory_links:
  - ludellus-tuning-log-design.md
---

# Ludellus play stream (fine-grained play log over WebSocket, analytics stage 1)

## Domain

Ludellus のデータ解析基盤の第1段 (neco 指示 2026-11-21)。ゲーム中の 1 解答ごとの記録とゲーム別の指標を、
遊んでいる最中に WebSocket で受け取り、既存の `play_sessions` / `play_events` に集積する。
終了時にセッションの集計 (所要時間・初回正答率・反応時間など) を作り、Ludellus の管理画面
(`/debug/stats/`、Lw `spec/feature/play-events.md`) が統計 API から読む。

取るもの (neco 指示): 始めた時間 / 終わりの時間 / 誤答と正答 / 問題提示から解答までの時間 /
誤答から次の解答までの時間 / 初回正答率 / その他各ゲームで決めた基準。

記録の形は `ludellus-tuning-log-design.md` §6 の `ludellus.trial_result` をそのまま使い、
§6.4 に `attempt` / `since_wrong_ms`、§6.10 に `ludellus.metric`、§6.11 に `ludellus.session_summary` を足した。
既存の HTTP 経路 (`/api/v1/sessions/*`) は変えない。終了時には既存の §12 ジョブ (能力推定・出題の較正) も走らせる。

記録の本人はログイン中の Cernere の user id (neco 指示 2026-11-21「Cr のログイン対応入れる」)。受けるのは Ludellus Web の中継
(ludellus-web `scripts/play-stream-proxy.mjs`) からだけで、ブラウザから直接は受けない。以前の固定モード
(`VOLUPTAS_PLAY_STREAM_FIXED_CERNERE_SUBJECT`) と許可 Origin (`VOLUPTAS_PLAY_STREAM_ALLOWED_ORIGINS`) は廃止した。

扱わないもの: 子ども (Ludellus の player) ごとの分け方 (記録の本人は保護者の Cernere アカウント)、記録の削除・書き出し。

## Contract

- `SPEC-VO-PLAY-STREAM-IDENTITY`: 中継と共有する合言葉 `VOLUPTAS_PLAY_STREAM_RELAY_TOKEN` (32 文字以上、Excubitor Vault) を
  設定したときだけ口を開く。本人は中継が `X-Ludellus-Cernere-Sub` で渡す Cernere の user id (`[A-Za-z0-9_-]{1,64}`)。
  `federated_identities (provider = 'cernere')` で `users.id` に結びつけ、居なければ通常ログインと同じ
  `findOrCreateUser` で作る (表示名「Ludellus プレイヤー」)。WebSocket は接続ごとに本人が決まり、その接続の全フレームを
  その人の記録にする。未設定・HASTER では WebSocket も統計 API も開かない。短い合言葉は起動時に例外。
  遊んでいる子ども (Ludellus の player、`p_` + 16 字) は、中継が保護者の子と確かめたときだけ `X-Ludellus-Player-Id` で渡す。
  形が違えば `400 PLAYER_ID_INVALID`。無ければ保護者だけの記録 (子ども不明)。クエリや本文では受けない (2026-11-23 neco 判断)。
- `SPEC-VO-PLAY-STREAM-REACH`: WebSocket と統計 API は、相手アドレスが loopback で、`Origin` が無く (ブラウザから直接は受けない)、
  `X-Forwarded-For` / `Forwarded` / `X-Real-IP` / `CF-Connecting-IP` が無く、`X-Ludellus-Play-Relay-Token` が合言葉と一致
  (sha256 を timingSafeEqual で比べる) するときだけ受ける。外れたら `403`、`X-Ludellus-Cernere-Sub` が無い・不正なら `401`。
- `SPEC-VO-PLAY-STREAM-SOCKET`: `GET /api/v1/play-stream` の WebSocket upgrade (`ws`、圧縮なし)。
  1 フレーム 16 KiB まで、バイナリは close `1003`。同時接続は `VOLUPTAS_PLAY_STREAM_WS_MAX` (既定 16) まで、超えたら `503`。
  同じ接続のメッセージは届いた順に処理し、処理待ちが 256 を超えたら close `1008`。他のパスの upgrade は閉じる。
- `SPEC-VO-PLAY-STREAM-FRAMES`: クライアント → サーバの JSON (strict)。
  - `session_start`: `{ sessionId (UUID、クライアント生成), seq: 0, gameId, startedAt (ISO 8601), metadata? }`。
    `metadata` は §5 の環境情報 (`mode` / `platform` など、16 項目まで、値は短い文字列・数値・真偽)。
  - `event`: `{ sessionId, seq (1〜), eventType (ludellus.trial_result | ludellus.metric), eventData }`。
    `eventData.seq` は `seq` と一致し、`trialResultSchema.js` の検査 (§11 の生テキスト拒否を含む) を通ること。
  - `session_end`: `{ sessionId, seq, endedAt, reason (completed | abandoned) }`。
  - 返事: `{ type: "ack", sessionId, seq }` か `{ type: "error", code, sessionId?, seq?, detail? }`
    (`invalid_frame` / `unknown_session` / `forbidden` / `session_ended` / `limit`)。
- `SPEC-VO-PLAY-STREAM-IDEMPOTENT`: セッションは `sessionId` で 1 行、記録は `(session_id, event_data.seq)` で 1 行。
  再送は保存し直さず `ack`。他人のセッションは `forbidden`。終了後の新しい記録は `session_ended`
  (終了前に保存済みの記録・終了そのものの再送は `ack`)。1 セッション 5000 記録まで (`limit`)。
- `SPEC-VO-PLAY-STREAM-SUMMARY`: `session_end` で `ended_at` を書き、同じトランザクションで
  `ludellus.session_summary` を `play_events` に置く: `duration_ms`、`answers` / `correct` / `wrong` / `timeouts`、
  `items`、`first_try_correct` / `first_try_accuracy` (attempt = 1 が正解だった問題 / 解答のあった問題、0 問なら null)、
  `response_ms_median` (attempt = 1、timeout の null は除く)、`since_wrong_ms_median`、`metrics` (名前ごとの count/sum/min/max/last)。
  その後 `runPostSessionJobs` を待たずに走らせる。
- `SPEC-VO-PLAY-STREAM-STATS`: `GET /api/v1/play-stream/stats?game_id=` (到達と本人の判定は REACH / IDENTITY と同じ、CORS なし)。
  その本人の終わったセッション (新しい順 500 件まで) から、ゲームごとの回数・完走数・合計時間・正誤数・
  問題数で重み付けした初回正答率・反応時間の中央値・指標の合計と、直近 20 セッションの集計を返す。生の記録は返さない。
  中継が子どもの id を付けたら、その子の記録だけを返す。最近の記録の各行に `player_id` (無ければ null) を付ける。
  子どもの id は `play_sessions.ludellus_player_id` (migration 021) に置き、つなぎ直しで別の子へは変えられない。

## Storage

新しい表は作らない。`play_sessions.id` にクライアントの UUID、`metadata.source = "ludellus.play_stream"`。
記録は `play_events` の `ludellus.trial_result` / `ludellus.metric` / `ludellus.session_summary`。

## Verification

`src/playStream/*.test.js` (フレーム・集計・保存と冪等・統計・設定と到達判定・WebSocket の往復と統計 API)、
`src/services/trialResultSchema.test.js` (attempt / since_wrong_ms / metric)。
