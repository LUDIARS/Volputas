# Concordia への感想通知 (SPEC-VO-CC-MANAGEMENT-EVENTS)

Gen5 Step 2。Voluptas に保存した感想を CDGD の変更列に載せる。実装参照は `actio:ec1f38ea-67bb-4e16-90cd-8c92c5413183`。
受け口は Concordia の `spec/feature/cdgd-management.md` にある CC-MGMT-02 `POST /v1/management/events`。

| 保存元 | `event_key` | `kind` | `origin` | `observed_at` |
|---|---|---|---|---|
| `ai_playtest_reviews` | `vo:ai-playtest:<run_id>` | `ai-playtest-review` | `ai` | `played_at`、欠けていれば `created_at` |
| `play_impressions` の削除されていない `ready` 行 | `vo:play-impression:<id>` | `play-impression` | `human` | `captured_at`、欠けていれば `created_at` |

- `source` は `vo`。時刻は Unix epoch ミリ秒。人の `game_id` は対応する `play_sessions` から取得する。Cernere が保持する GLAB の `voices` はこの配送の対象外。
- `project_code` は `game_id` を NFKC 正規化して前後の空白を除き、Cc が受理する ASCII 形式と長さを満たせば大小文字を維持する。形式外の値は `game-` と SHA-256 の先頭 32 桁で表す。`target_key` は `game/<game_id>` とし、キーの形式外では同じ `project_code` を使う。イベントキーに収まらない `run_id` は `sha256/` と SHA-256 の 64 桁で表す。
- AI の要約はゲーム名、要約、良い点・悪い点・迷った点から各最大 2 件のテキストで作り、受け口の上限である UTF-16 の 2000 コード単位に収める。識別子や証跡の構造化フィールドを渡さず、テキストに現れるメールアドレス、URL、既知形式の ID、電話番号などをマスクする。AI の入力元は個人情報を含まない感想を生成する。人の要約は定型文「プレイ感想が保存されました。」を使い、自由記述、著者、セッション、添付情報を配送クエリで取得しない。

## 接続と再送

- `CONCORDIA_MANAGEMENT_EVENTS_URL` を優先し、空なら `CONCORDIA_URL` のオリジン上の `/v1/management/events` を使う。両方未設定、または優先される設定が `off` の場合は静かに停止する。オンライン実行だけでワーカーを登録し、HASTER は設定評価の前に除外する。
- HTTPS、loopback HTTP、Tailscale IPv4 HTTP を既存の URL 検証で許可する。資格情報、自動リダイレクト、認証ヘッダーは使わない。送信先には CC-MGMT-02 が受理できる経路を設定する。
- 起動時と 1 分周期に、種類ごとに未試行を先に、続いて最終試行の古い順に最大 25 件ずつ取得する。実行中の周期があれば重ねない。停止時は周期と HTTP リクエストを取り消す。
- migration 020 の `cc_management_event_delivery` に送信結果を保存する。2xx は `delivered`、4xx は `refused` とし、両者は次回の対象から外す。5xx、応答不明、通信失敗は `pending` として次周期以降に送る。配送結果の更新と元データの保存は独立し、未試行の既存行も配送できる。停止や状態保存の失敗で結果が不明な場合は、同じキーで再送し Cc の冪等性で重複登録を防ぐ。

## 実装

- `managementEventPayload.mjs` が保存行から通知を組み立て、`managementEventsClient.mjs` が HTTP 応答を配送状態に変換する。
- `managementEventDeliveryRepository.js` が配送待ちの保存行を読み、`managementEventDelivery.js` が種類ごとに送信と状態記録を行う。
- `managementEvents.js` が接続先を解決し、`startManagementEventDelivery.js` が `periodicPush.js` を使ってオンラインの配送周期と停止を管理する。
