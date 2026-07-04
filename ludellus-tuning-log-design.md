# Ludellus プレイログ設計書 — 能力推定・ゲームチューニング・サジェスト基盤

> **Version 1.0** | 2026-07-02
> Ludellus / Ludellus-Server のプレイ結果から反応速度・言語理解度を抽出し、
> ユーザーの能力に沿ったゲームチューニングと難易度・ゲームサジェストを実現するためのログデータ設計

---

## 目次

1. [目的とゴール](#1-目的とゴール)
2. [前提と想定](#2-前提と想定)
3. [計測モデル — 何をどう測るか](#3-計測モデル--何をどう測るか)
4. [ログ設計の基本原則](#4-ログ設計の基本原則)
5. [セッションログ設計](#5-セッションログ設計)
6. [イベントログ設計](#6-イベントログ設計)
7. [出題コンテンツマスタ](#7-出題コンテンツマスタ)
8. [派生指標 — 能力推定](#8-派生指標--能力推定)
9. [チューニングとサジェストへの接続](#9-チューニングとサジェストへの接続)
10. [Ludellus-Server (マルチプレイ) 特有の考慮](#10-ludellus-server-マルチプレイ-特有の考慮)
11. [データ品質・プライバシー](#11-データ品質プライバシー)
12. [既存基盤への実装マッピング](#12-既存基盤への実装マッピング)

---

## 1. 目的とゴール

Ludellus / Ludellus-Server のプレイ結果ログから、以下の 3 つを実現する。

| ゴール | 必要となる情報 |
|--------|----------------|
| **G1. 能力抽出** — 反応速度・言語理解度の推定 | 刺激(出題)単位の提示時刻・入力時刻・正誤と、出題の難易度属性 |
| **G2. ゲームチューニング** — ユーザー能力に沿った難易度パラメータの自動調整 | G1 の推定値 + 現在の難易度パラメータと、その下での成績の対応関係 |
| **G3. サジェスト** — 次の難易度・得意なゲーム(モード)の提案 | ゲーム/モード横断で比較可能な正規化スキル指標 + 提案への反応 (受諾/拒否) |

このうちログ設計として最も重要なのは **G1 を成立させる粒度でログを取ること**である。
セッション単位・ラウンド単位の集計値 (スコア、正答率) だけでは「速いが読めていない」のか「読めるが遅い」のかを分離できず、G2/G3 の精度が頭打ちになる。したがって本設計は **1 出題 = 1 トライアル (trial)** を最小記録単位とする。

また G2/G3 は「調整・提案した結果どうなったか」のフィードバックループを回して初めて改善できるため、**チューニング適用・サジェスト提示/受諾もログイベントとして記録する** (閉ループ設計)。

---

## 2. 前提と想定

Ludellus 本体の仕様は本リポジトリ外のため、以下を前提として設計する。実際の仕様と異なる場合はイベントペイロード (`event_data`) の game 固有部分のみ差し替えればよい構造にしてある。

| 項目 | 想定 |
|------|------|
| Ludellus | 言語(単語・文章)を題材に、提示された刺激へ素早く正しく応答する形式のゲーム。ソロプレイ中心 |
| Ludellus-Server | 同ゲームのサーバー対戦版。複数プレイヤーが同一の出題にリアルタイムで応答する |
| クライアント | ネイティブアプリ or ブラウザ。ローカルで高精度な時刻計測 (monotonic clock) が可能 |
| ログ送信先 | 本リポジトリの player-profile-server (`POST /api/v1/sessions/:id/events/batch`) |
| 出題 | 出題アイテム (単語・文・問題) はサーバー側マスタで管理され、ID で参照できる |

`game_id` は `ludellus` (ソロ) / `ludellus-server` (対戦) の 2 値とし、既存 `play_sessions.game_id` にそのまま入れる。

---

## 3. 計測モデル — 何をどう測るか

### 3.1 応答時間の分解

1 トライアルの時間経過を次のように分解して記録する。これが本設計の中核。

```
刺激提示                最初の入力              回答確定
   │◄── 認知・判断時間 ──►│◄── 入力(運動)時間 ──►│
   │                      │                      │
   ├──── first_input_ms ──┤                      │
   ├────────────── response_ms ──────────────────┤
```

| 計測値 | 定義 | 主に反映する能力 |
|--------|------|------------------|
| `first_input_ms` | 刺激提示 → 最初の入力操作までの時間 | 反応速度 + 読解・判断時間 |
| `response_ms` | 刺激提示 → 回答確定までの時間 | 総合応答時間 |
| `response_ms - first_input_ms` | 入力開始 → 確定 | 入力操作速度 (デバイス・運動要因) |

### 3.2 「反応速度」と「言語理解度」の分離

`first_input_ms` には「純粋な反射」と「言語を読んで理解する時間」が混在する。これを分離するために 2 つの仕掛けをログ設計に組み込む。

1. **キャリブレーション計測** — 言語処理を伴わない単純刺激 (色・形・音への反応) のトライアルを起動時や定期的に挟み、ユーザーの**運動反応ベースライン** (`motor_baseline_ms`) を取得する (`calibration_result` イベント)。
2. **出題側の難易度属性** — 各出題アイテムに文字数・語彙レベル・漢字率などの属性を持たせる。これにより:

```
反応速度   ≈ キャリブレーション試行の first_input_ms 分布
言語理解度 ≈ (first_input_ms − motor_baseline_ms) を出題の言語負荷で正規化した値
           + 語彙レベル別の正答率カーブ
```

| 指標 | 算出方法 |
|------|----------|
| 反応速度 | 単純刺激トライアルの `first_input_ms` の中央値 / p10 / p90 |
| 読解速度 | `(first_input_ms − motor_baseline) / text_len` → ms/文字 (文字あたり読解時間) |
| 語彙・理解レベル | 出題の `vocab_level` 別正答率から、正答率がしきい値 (例: 70%) を割るレベル境界を推定 |
| 理解の確からしさ | 正答率だけでなく `corrections` (入力修正回数)・`timeout` 率も併用 |

**設計上の含意:** トライアルログは必ず「出題アイテムの難易度属性」とセットで解釈できる必要がある。→ [§7 コンテンツマスタ](#7-出題コンテンツマスタ)

### 3.3 対戦時の時刻補正

Ludellus-Server では刺激の提示がサーバー起点になるため、ネットワーク遅延が計測を汚す。**時間はすべてクライアントの単調クロックで計測し、サーバー時刻から算出しない**。RTT はイベントに添付し、補正・除外判断は分析側で行う。→ [§10](#10-ludellus-server-マルチプレイ-特有の考慮)

---

## 4. ログ設計の基本原則

| # | 原則 | 理由 |
|---|------|------|
| 1 | **トライアル粒度で記録する** | 集計値では速度と理解度を分離できない (§3) |
| 2 | **時間差はクライアント単調クロックで計測** | 壁時計は NTP 補正・タイムゾーンでずれる。`Date.now()` 差分は計測に使わない |
| 3 | **出題はマスタ参照 (item_id) + 主要属性のスナップショット併記** | マスタ改訂後も過去ログを解釈可能にする。分析はスナップショットを一次ソースにする |
| 4 | **生ログと派生指標を分離** | `play_events` は不変の事実、能力推定値は再計算可能な派生テーブルへ (§8) |
| 5 | **その時点の難易度パラメータを結果に併記** | 「どの設定下での成績か」が無いとチューニングの効果測定ができない |
| 6 | **チューニング・サジェスト自体もイベントとして記録** | 閉ループでの効果検証 (G2/G3 の改善) に必須 |
| 7 | **`seq` によるセッション内連番** | バッチ送信・リトライでの欠損/重複/順序乱れを検知する |
| 8 | **スキーマバージョン (`v`) を全イベントに付与** | クライアント更新が段階的でも分析側でハンドリング可能にする |

---

## 5. セッションログ設計

既存 `play_sessions` をそのまま使う。`metadata` (JSONB) に以下を格納する。
セッション開始時 (`POST /api/v1/sessions`) に確定する環境情報が対象。

```json
{
  "v": 1,
  "app_version": "1.4.2",
  "content_pack_version": "2026.06",
  "platform": "ios | android | windows | web",
  "device_class": "phone | tablet | pc",
  "input_method": "touch | keyboard | gamepad",
  "screen_refresh_hz": 120,
  "locale": "ja-JP",
  "mode": "solo | versus | coop",
  "server_region": "ap-northeast-1",
  "initial_tuning_version": 12
}
```

| フィールド | G1〜G3 での用途 |
|-----------|-----------------|
| `input_method` / `device_class` | 反応速度はデバイスで大きく変わるため、能力推定はデバイスクラス別に層別する |
| `screen_refresh_hz` | 提示タイミングの量子化誤差 (最大 1 フレーム) の見積もり |
| `content_pack_version` | 出題マスタのバージョン。item スナップショットとの突合に使用 |
| `initial_tuning_version` | セッション開始時点で適用されていたチューニングの版 (§9) |

---

## 6. イベントログ設計

既存 `play_events` (`event_type` + `event_data` JSONB) に格納する。`event_type` は `ludellus.` プレフィックスで名前空間を切る。

### 6.1 共通エンベロープ

全イベントの `event_data` は以下の共通フィールドを持つ。

```json
{
  "v": 1,
  "seq": 42,
  "round_id": "8f3c…",
  "client_ts": "2026-07-02T12:34:56.789+09:00",
  "mono_ms": 1234567
}
```

| フィールド | 説明 |
|-----------|------|
| `v` | イベントスキーマバージョン |
| `seq` | セッション内の単調増加連番。欠損・重複・順序検知用 |
| `round_id` | 所属ラウンド (UUID、クライアント生成)。ラウンド外イベントは null |
| `client_ts` | クライアント壁時計 (ISO 8601)。表示・突合用であり時間差計算には使わない |
| `mono_ms` | クライアント単調クロック (アプリ起動からの ms)。**すべての時間差はこの系で計算する** |

### 6.2 イベント一覧

| event_type | タイミング | 目的 |
|------------|-----------|------|
| `ludellus.round_start` | ラウンド開始 | 難易度パラメータの記録 (原則 5) |
| `ludellus.trial_result` | 各出題の回答確定/タイムアウト時 | **中核イベント**。速度・理解度の原データ |
| `ludellus.round_result` | ラウンド終了 | ラウンド集計・対戦結果 |
| `ludellus.calibration_result` | キャリブレーション試行完了時 | 運動反応ベースライン取得 |
| `ludellus.pause` / `ludellus.resume` | 中断/再開 | 計測無効区間の特定 |
| `ludellus.tuning_applied` | 難易度パラメータ変更時 | チューニング閉ループ (G2) |
| `ludellus.suggestion_shown` / `ludellus.suggestion_response` | サジェスト提示/応答時 | サジェスト閉ループ (G3) |
| `ludellus.net_sample` | 対戦時、定期 (例: 30秒毎) | RTT・クロックオフセットの記録 |

### 6.3 `ludellus.round_start`

```json
{
  "…共通…",
  "mode": "versus",
  "difficulty_params": {
    "preset": "normal",
    "time_limit_ms": 8000,
    "vocab_level_range": [3, 5],
    "text_len_range": [8, 40],
    "distractor_similarity": 0.6,
    "simultaneous_stimuli": 1
  },
  "tuning_version": 12,
  "player_count": 4,
  "match_id": "srv-20260702-0193"
}
```

`difficulty_params` はゲームが持つチューニング可能な軸をすべて列挙する。ここに載らないパラメータは自動チューニングの対象にできない。

### 6.4 `ludellus.trial_result` — 中核イベント

1 出題につき 1 イベント。回答確定・タイムアウト・放棄のいずれでも必ず送る。

```json
{
  "…共通…",
  "trial_id": "b2a1…",
  "trial_index": 7,

  "item_id": "vocab_ja_00123",
  "item_version": 3,
  "item_snapshot": {
    "task_type": "word_match",
    "lang": "ja",
    "text_len": 24,
    "vocab_level": 4,
    "kanji_ratio": 0.35,
    "difficulty": 0.62
  },

  "presented_mono_ms": 1230000,
  "first_input_ms": 480,
  "response_ms": 2350,
  "time_limit_ms": 8000,
  "paused_ms": 0,

  "input_events": 5,
  "corrections": 1,

  "outcome": "correct | wrong | timeout | abandoned",
  "score": 1.0,
  "answer_detail": { "chosen_idx": 2, "expected_idx": 2 },

  "rtt_ms": 42
}
```

| フィールド | 説明 / 用途 |
|-----------|-------------|
| `trial_id` / `trial_index` | トライアル識別子とラウンド内の出題順。順序効果 (疲労・ウォームアップ) の分析用 |
| `item_id` + `item_version` | 出題マスタへの参照 (§7) |
| `item_snapshot` | 分析に必須の難易度属性の写し。マスタ改訂に対して自己完結 |
| `presented_mono_ms` | 刺激が**実際に描画された**フレームの単調クロック値。描画確定 (vsync 後) で取ること |
| `first_input_ms` | 提示 → 最初の入力。**null 許容** (無入力タイムアウト時) |
| `response_ms` | 提示 → 回答確定。タイムアウト時は null |
| `paused_ms` | トライアル中の中断合計。0 以外は速度分析から除外 |
| `input_events` / `corrections` | 入力回数・修正 (削除) 回数。迷い・確信度の代理指標 |
| `outcome` / `score` | 正誤。部分点があるゲームのため score (0.0〜1.0) を併設 |
| `answer_detail` | 誤答分析用。**自由入力の生テキストは入れない** (§11)。選択肢 index、または誤答の編集距離などの派生量のみ |
| `rtt_ms` | 対戦時のみ。直近の RTT 計測値 |

> **アンチパターン:** `trial_result` を正解時のみ送る、タイムアウトを送らない、といった間引きは正答率・タイムアウト率の分母を壊すため禁止。

### 6.5 `ludellus.round_result`

```json
{
  "…共通…",
  "trials_total": 20,
  "trials_correct": 16,
  "trials_timeout": 1,
  "score": 1840,
  "duration_ms": 182000,
  "completed": true,
  "rank": 2,
  "player_count": 4,
  "opponent_ratings": [1420, 1510, 1188]
}
```

トライアルの集計はサーバー側でも再計算できるが、クライアント集計値を併送することで欠損検知 (`trials_total` と受信 trial 数の突合) ができる。`rank` / `opponent_ratings` は対戦時のみ。相対成績を能力推定に使う際、相手の強さで正規化するために必要。

### 6.6 `ludellus.calibration_result`

```json
{
  "…共通…",
  "calibration_type": "visual_simple | audio_simple | choice_2",
  "trials": [
    { "first_input_ms": 285, "outcome": "correct" },
    { "first_input_ms": 310, "outcome": "correct" }
  ]
}
```

言語処理を含まない単純反応課題の結果。§3.2 の `motor_baseline_ms` の算出元。起動時のウォームアップ演出やチュートリアルに組み込むとユーザー負担なく取得できる。1 セッションに数試行で十分。

### 6.7 `ludellus.tuning_applied`

```json
{
  "…共通…",
  "tuning_version": 13,
  "source": "auto | suggestion_accepted | manual",
  "params_before": { "time_limit_ms": 8000, "vocab_level_range": [3, 5] },
  "params_after":  { "time_limit_ms": 6500, "vocab_level_range": [4, 6] }
}
```

`source: manual` (ユーザーが自分で難易度を変えた) は「自動チューニングが本人の望みとずれていた」ことを示す最重要シグナルなので、必ず区別して記録する。

### 6.8 `ludellus.suggestion_shown` / `ludellus.suggestion_response`

```json
// shown
{
  "…共通…",
  "suggestion_id": "sg-01H…",
  "kind": "difficulty_up | difficulty_down | game_mode | content_category",
  "payload": { "to_preset": "hard" },
  "reason_code": "high_accuracy_fast_response"
}

// response
{
  "…共通…",
  "suggestion_id": "sg-01H…",
  "action": "accepted | dismissed | ignored",
  "latency_ms": 3400
}
```

`suggestion_id` で shown と response を突合し、提案の受諾率・その後の継続率を評価する (G3 の改善ループ)。

### 6.9 `ludellus.net_sample` (対戦時のみ)

```json
{ "…共通…", "rtt_ms": 42, "jitter_ms": 6, "server_clock_offset_ms": -13 }
```

---

## 7. 出題コンテンツマスタ

トライアルログを能力推定に使うには、出題側の難易度が定量化されている必要がある。出題アイテムのマスタテーブルを新設する。

### 7.1 `content_items` (新規テーブル)

| カラム | 型 | 説明 |
|--------|-----|------|
| id | VARCHAR(100) PK | アイテム ID (例: `vocab_ja_00123`) |
| version | INTEGER PK | 改訂版番号 (複合 PK) |
| game_id | VARCHAR(100) | `ludellus` / `ludellus-server` / 共通 |
| task_type | VARCHAR(50) | `word_match` / `sentence_read` / `listen_choice` 等 |
| lang | VARCHAR(10) | 出題言語 |
| attributes | JSONB | 難易度属性 (下表) |
| stats | JSONB | 全ユーザー実績からの較正値 (正答率、平均応答時間、IRT 困難度) |
| is_active | BOOLEAN | 出題可否 |
| created_at | TIMESTAMPTZ | |

`attributes` の標準キー:

| キー | 型 | 説明 |
|------|-----|------|
| `text_len` | int | 表示文字数 |
| `vocab_level` | int | 語彙レベル (1=易 〜 N=難。学年・JLPT 等の内部尺度) |
| `kanji_ratio` | float | 漢字含有率 (日本語出題時) |
| `syntax_complexity` | float | 文構造の複雑さ (文のみ) |
| `category` | string | 意味領域 (動物・科学・日常 等)。得意分野分析用 |
| `difficulty` | float | 総合困難度 0.0〜1.0 (初期値は人手/ルール、運用後は `stats` で較正) |

### 7.2 較正ループ

全ユーザーの `trial_result` を集計して `stats` (実測正答率・応答時間分布) を定期更新する。これにより:

- `difficulty` の初期値 (人手設定) を実データで補正できる
- 個人の能力推定が「較正済みアイテム困難度に対する成績」として安定する (IRT 的推定の土台)

---

## 8. 派生指標 — 能力推定

生ログ (play_events) から非同期ジョブで算出し、別テーブルに保存する。**派生値はすべて生ログから再計算可能**であること (アルゴリズム改善時に全履歴で作り直せる)。

### 8.1 `player_ability_snapshots` (新規テーブル)

| カラム | 型 | 説明 |
|--------|-----|------|
| id | BIGSERIAL PK | |
| user_id | UUID FK → users.id | |
| game_id | VARCHAR(100) | ゲーム別 (横断指標は `_all`) |
| device_class | VARCHAR(20) | デバイス層別 (§5) |
| metrics | JSONB | 指標セット (下表) |
| sample_trials | INTEGER | 根拠となったトライアル数 |
| window_start / window_end | TIMESTAMPTZ | 集計対象期間 |
| algo_version | INTEGER | 推定アルゴリズムの版 |
| computed_at | TIMESTAMPTZ | |

`metrics` の標準キー:

| キー | 定義 | 由来イベント |
|------|------|-------------|
| `motor_baseline_ms` | 単純反応時間の中央値 | `calibration_result` |
| `reaction_p50_ms` / `reaction_p10_ms` / `reaction_p90_ms` | 低言語負荷トライアルの `first_input_ms` 分布 | `trial_result` |
| `reading_speed_ms_per_char` | `(first_input_ms − motor_baseline) / text_len` の頑健平均 | `trial_result` |
| `vocab_level_estimate` | 正答率 70% を維持できる最大 `vocab_level` (補間値) | `trial_result` × item 属性 |
| `accuracy_by_level` | `{ "3": 0.94, "4": 0.81, "5": 0.55 }` 形式の正答率カーブ | 同上 |
| `accuracy_by_category` | 意味領域別正答率 → 得意分野 | 同上 |
| `timeout_rate` | タイムアウト率 | 同上 |
| `consistency` | 応答時間の変動係数 (低いほど安定) | 同上 |
| `trend_7d` | 直近 7 日の EWMA 変化率 (上達曲線) | スナップショット系列 |

### 8.2 推定時の除外・重み付けルール

| ルール | 内容 |
|--------|------|
| 中断除外 | `paused_ms > 0` のトライアルは速度指標から除外 (正誤には使用可) |
| 外れ値除去 | `first_input_ms < 150ms` (予測入力/連打) と p99 超は除外 |
| RTT 補正 | 対戦時、`rtt_ms/2` を提示遅延見込みとして控除。`rtt_ms` が閾値超のトライアルは速度指標から除外 |
| 鮮度重み | 古いトライアルは指数減衰 (半減期 ~30 日)。能力は変化するため |
| 最小標本 | `sample_trials` が閾値 (例: 30) 未満の指標は `confidence: low` を付け、チューニングでは保守的に扱う |

---

## 9. チューニングとサジェストへの接続

### 9.1 `player_tuning_params` (新規テーブル)

| カラム | 型 | 説明 |
|--------|-----|------|
| user_id | UUID | 複合 PK |
| game_id | VARCHAR(100) | 複合 PK |
| tuning_version | INTEGER | 単調増加。クライアントはこれをイベントに刻む |
| params | JSONB | `difficulty_params` と同スキーマ (§6.3) |
| based_on_snapshot | BIGINT FK | 根拠にした ability snapshot |
| computed_at | TIMESTAMPTZ | |

クライアントはセッション開始時にこれを取得し、`round_start` / `tuning_applied` に `tuning_version` を刻む。これで「どの推定に基づくどの設定で、どんな成績だったか」が全部つながる。

### 9.2 チューニング写像の例

| 能力指標 | 調整パラメータ | ロジック例 |
|----------|----------------|------------|
| `reaction_p50_ms` + `reading_speed` | `time_limit_ms` | 「推定読解時間 + 反応時間の p75 + 余裕係数」で制限時間を個人化 |
| `vocab_level_estimate` | `vocab_level_range` | 推定レベル ±1 を出題中心に。正答率 75〜85% ゾーンを狙う |
| `consistency` 低 | `simultaneous_stimuli` | 応答が不安定なユーザーには同時刺激数を増やさない |
| `accuracy_by_category` | 出題カテゴリ配分 | 苦手領域を少量混ぜる (練習効果) or 得意領域中心 (快適さ) — プロダクト方針で切替 |

### 9.3 サジェストの成立条件

| サジェスト | 判定に使う指標 |
|-----------|----------------|
| 難易度アップ提案 | 直近 window で正答率 > 90% かつ `response_ms` p50 が制限時間の 50% 未満 |
| 難易度ダウン提案 | 正答率 < 55% または `timeout_rate` > 20%、かつ `trend_7d` が非改善 |
| 得意ゲーム/モード提案 | ゲーム別 snapshot をゲーム内全ユーザー分布に対する percentile へ正規化して比較 (絶対値はゲーム間で比較不能なため) |

提案の質は `suggestion_shown` / `suggestion_response` (§6.8) と、その後の成績・継続率で評価する。

---

## 10. Ludellus-Server (マルチプレイ) 特有の考慮

| 課題 | 対策 (ログ設計上) |
|------|-------------------|
| 提示タイミングがサーバー起点 → 遅延混入 | `presented_mono_ms` は**クライアントで実際に描画した時刻**。サーバー送信時刻は使わない |
| RTT の変動 | `net_sample` の定期記録 + `trial_result.rtt_ms`。分析側で補正/除外 (§8.2) |
| 相手の強さで成績が変わる | `round_result` に `rank` / `player_count` / `opponent_ratings` を記録し、相対評価に使う |
| 対戦のプレッシャー効果 | `mode` で層別。ソロと対戦の速度指標は分けて推定し、比較自体を「プレッシャー耐性」指標として扱える |
| サーバー側の正解判定 | 判定はサーバー authoritative でも、**時間計測はクライアント計測値を採用**。サーバーは妥当性検証 (chess-clock 的に受信時刻と大きく矛盾しないか) のみ行う |
| 不正・チート | クライアント計測は改ざん可能。`first_input_ms` が人間の下限 (~150ms) を高頻度で下回る等の異常はサーバーで検知し、該当ユーザーの速度指標に `suspect` フラグ |

---

## 11. データ品質・プライバシー

| 領域 | 方針 |
|------|------|
| 欠損検知 | `seq` の抜け + `round_result` 集計値と trial 受信数の突合 |
| 重複排除 | バッチ再送に備え `(session_id, seq)` で冪等に取り込む |
| 自由入力テキスト | **生入力は記録しない**。正誤・編集距離・修正回数など派生量のみ (`answer_detail`)。誤入力に個人情報が含まれるリスクを遮断 |
| 音声入力 (あれば) | 音声データは送らない。認識結果の正誤と信頼度スコアのみ |
| 能力データの扱い | 反応速度・言語理解度は準センシティブ (認知能力の推定値)。本人以外への公開 API には出さない。`DELETE /users/me` で snapshot 含め削除 |
| 保持期間 | `trial_result` 等の生イベントは既存方針どおり 90 日でアーカイブ。`player_ability_snapshots` は再計算の要約として長期保持 |
| ボリューム見積 | 1 セッション ≈ 5 ラウンド × 20 trial + 周辺イベント ≈ **~120 events/session**。既存 NFR (batch 10,000 events/sec) の範囲内だが、`play_events` のパーティショニング (月次、`occurred_at`) を推奨 |

---

## 12. 既存基盤への実装マッピング

| 本設計の要素 | 既存基盤での実装 |
|--------------|------------------|
| セッションログ (§5) | `play_sessions.metadata` — 変更不要 |
| イベントログ (§6) | `play_events` (`event_type` / `event_data`) — 変更不要。送信は既存 batch API |
| コンテンツマスタ (§7) | **新規テーブル** `content_items` (migration 003) |
| 能力スナップショット (§8) | **新規テーブル** `player_ability_snapshots` (migration 003) |
| チューニングパラメータ (§9) | **新規テーブル** `player_tuning_params` (migration 003) + 取得 API `GET /api/v1/games/:gameId/tuning/me` |
| 能力推定ジョブ | `analysisEngine` と同じ非同期ジョブ枠に `abilityEngine` を追加 (セッション終了時トリガー)。嗜好分析 (classification) とは独立に動かす |
| 嗜好分析との関係 | `trial_result` 等は既存 `EVENT_DIMENSION_MAP` に無いイベントなので嗜好分析には影響しない。将来的に「高難度を好む」等のシグナルとして接続可能 |

### 実装フェーズ案

| フェーズ | 内容 |
|----------|------|
| Phase 1 | クライアント実装: 共通エンベロープ + `round_start` / `trial_result` / `round_result` / `pause` |
| Phase 2 | `content_items` マスタ整備 + `calibration_result` + 能力推定ジョブ (snapshot 生成) |
| Phase 3 | `player_tuning_params` + チューニング配信 API + `tuning_applied` |
| Phase 4 | サジェスト (`suggestion_*`) + 閉ループ評価ダッシュボード |

---

## 改訂履歴

| バージョン | 日付 | 内容 |
|------------|------|------|
| 1.0 | 2026-07-02 | 初版作成 |
