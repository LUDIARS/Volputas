# Player Profile Backend — 設計書

> **Version 1.0** | 2026-03-16  
> ユーザーのプレイスタイル・個性登録サーバーの設計書  
> IdPフェデレーション認証 · ゲームプレイロギング · 嗜好・感情分析基盤

---

## 目次

1. [概要](#1-概要-overview)
2. [システムアーキテクチャ](#2-システムアーキテクチャ)
3. [認証設計](#3-認証設計-authentication)
4. [データベース設計](#4-データベース設計)
5. [API設計](#5-api設計)
6. [嗜好分析基盤](#6-嗜好分析基盤)
7. [セキュリティ](#7-セキュリティ)
8. [非機能要件](#8-非機能要件)
9. [マイルストーン](#9-マイルストーン)

---

## 1. 概要 (Overview)

本ドキュメントは、ゲームプレイヤーのプレイスタイルや個性を登録・管理するバックエンドサーバーの設計を記述する。サービス独自のSIDを発行し、Google/Discord等の外部IdPとフェデレーションする。Voluptas自身はOpenID Providerではなく、認証後は自サービスのRS256 JWTを発行する。

また、ゲームプレイログやアンケートからユーザーの嗜好を分析する基盤も提供する。

### 1.1 スコープ

| 領域 | 説明 |
|------|------|
| 認証・ユーザー管理 | OpenID Connect型のID発行、外部IdP連携、プロフィールCRUD |
| ゲームプレイロギング | イベント収集API、セッション管理、バッチ取り込み |
| アンケート基盤 | 設問定義・回答収集API、テンプレート管理 |
| 嗜好分析 | ログ・アンケート統合によるプレイヤープロファイル生成 |

### 1.2 用語定義

| 用語 | 定義 |
|------|------|
| Service ID (SID) | 本サービスが発行するUUID v4形式のユーザー識別子 |
| IdP | Identity Provider。Google, Discord, Steam等の外部認証プロバイダ |
| Federated Identity | IdPのsubクレームとSIDを紐付けるレコード |
| Player Profile | プレイスタイル・個性・嗜好情報の集合体 |
| Play Log | ゲーム内イベントの構造化ログデータ |
| Preference Vector | 嗜好分析結果を表す多次元ベクトル |

---

## 2. システムアーキテクチャ

### 2.1 全体構成

| レイヤー | 責務 | 技術候補 |
|----------|------|----------|
| API Gateway | ルーティング、レートリミット、CORS、TLS終端 | Nginx / AWS ALB / Cloudflare |
| Auth Service | OpenID Connectフロー、トークン発行・検証 | Node.js (Express) |
| Profile Service | ユーザーCRUD、プレイスタイル管理 | Node.js (Express) |
| Logging Service | イベント収集、セッション管理 | Node.js (Express) |
| Survey Service | アンケート定義・回答収集 | Node.js (Express) |
| Analysis Engine | 嗜好ベクトル計算、プロファイル生成 | Python / Node.js (Worker) |
| Database | 永続化層 | PostgreSQL + Redis (cache) |
| Message Queue | 非同期分析ジョブ | Redis Streams / RabbitMQ |

### 2.2 データフロー図

```
Client (Game / Web)
  │  1. Authorization Code (Google OAuth2)
  ▼
Auth Service  ───  Google IdP (id_token 検証)
  │  2. SID発行 or 紐付け  →  JWT返却
  ▼
Profile / Logging / Survey API
  │  3. JWT認証付きリクエスト
  ▼
PostgreSQL / Redis  ───  Analysis Engine (非同期)
```

### 2.3 ディレクトリ構成

```
player-profile-server/
├── src/
│   ├── routes/           # APIルート定義
│   │   ├── auth.js       #   OpenID Connect認証フロー
│   │   ├── users.js      #   ユーザーCRUD
│   │   ├── profiles.js   #   プレイスタイル・嗜好
│   │   ├── logs.js       #   ゲームプレイロギング
│   │   └── surveys.js    #   アンケート
│   ├── models/           # DBスキーマ・リポジトリ
│   ├── services/         # ビジネスロジック
│   ├── middleware/       # 認証・バリデーション
│   └── config/           # 設定ファイル
├── migrations/           # DBマイグレーション
├── analysis/             # 嗜好分析エンジン
└── docs/                 # 設計書・APIドキュメント
```

---

## 3. 認証設計 (Authentication)

### 3.1 IdPフェデレーションフロー

ブラウザはIdPのAuthorization Codeをcallbackで受け、60秒有効のone-time login ticketだけをURL fragmentでSPAへ渡す。SPAは`POST /auth/ticket`でVoluptas JWTへ一度だけ交換する。ネイティブクライアント向け`POST /auth/token`はIdPへ`code_verifier`を渡すPKCE経路として維持する。OAuth stateはRedisで600秒保持し、`GETDEL`で一度だけ消費する（Redis未設定の開発環境のみprocess-local）。

#### フローシーケンス

| Step | アクター | アクション |
|------|----------|------------|
| 1 | Client | `code_verifier` を生成、`code_challenge` を計算 |
| 2 | Client | `GET /auth/login?provider=google` にリダイレクト |
| 3 | Auth Service | GoogleのAuthorization Endpointへリダイレクト (`code_challenge` 付き) |
| 4 | ユーザー | Googleで認証・同意 |
| 5 | Google | Authorization CodeをCallback URLへ返却 |
| 6 | Auth Service | `POST /auth/callback` で `code` + `code_verifier` を受理 |
| 7 | Auth Service | Google Token Endpointで `id_token` を取得 |
| 8 | Auth Service | `id_token` 検証 → `sub` クレーム抽出 |
| 9 | Auth Service | `federated_identities` 検索。未登録ならSID (UUID v4) 発行 + 紐付け |
| 10 | Auth Service | サービスJWT (`access_token` + `refresh_token`) を返却 |

### 3.2 トークン設計

| 項目 | 詳細 |
|------|------|
| Access Token | JWT (RS256)、有効期限 15分 |
| Refresh Token | ランダム文字列、有効期限 30日、DB保存 + ローテーション |
| JWT Claims | `sub` (SID), `iss` (サービスURL), `aud` (client_id), `exp`, `iat`, `jti` |
| JWKS Endpoint | `GET /auth/.well-known/jwks.json` で公開鍵を配信 |
| 鍵ローテーション | RS256鍵ペアは90日ごとにローテート、`kid` で識別 |

### 3.3 サポートするIdP

| IdP | provider値 | 取得クレーム | 用途 |
|-----|-----------|-------------|------|
| Google | `google` | sub, email, name, picture | メイン認証 |
| Discord | `discord` | id, username, avatar | ゲーマーコミュニティ連携 |
| Steam | — | — | 将来対応。OpenID 2.0専用実装が必要なため現行OAuth経路では無効 |

---

## 4. データベース設計

PostgreSQLを使用。主要テーブルとその関係を以下に示す。

### 4.1 users

| カラム | 型 | 制約 | 説明 |
|--------|-----|------|------|
| id | UUID | PK | サービス発行ID (SID) |
| display_name | VARCHAR(100) | NOT NULL | 表示名 |
| avatar_url | TEXT | | アバターURL |
| locale | VARCHAR(10) | DEFAULT 'ja' | ロケール |
| created_at | TIMESTAMPTZ | NOT NULL | 作成日時 |
| updated_at | TIMESTAMPTZ | NOT NULL | 更新日時 |

### 4.2 federated_identities

| カラム | 型 | 制約 | 説明 |
|--------|-----|------|------|
| id | BIGSERIAL | PK | レコードID |
| user_id | UUID | FK → users.id | サービスユーザーID |
| provider | VARCHAR(50) | NOT NULL | IdP識別子 (google等) |
| provider_sub | VARCHAR(255) | NOT NULL | IdPが発行したsub |
| email | VARCHAR(255) | | IdPから取得したemail |
| raw_profile | JSONB | | allowlist済みIdPフィールドのみ（sub/id/name/username/picture/avatar/email/email_verified/locale） |
| linked_at | TIMESTAMPTZ | NOT NULL | 連携日時 |

> **ユニーク制約:** `(provider, provider_sub)`

### 4.3 player_profiles

| カラム | 型 | 制約 | 説明 |
|--------|-----|------|------|
| user_id | UUID | PK, FK → users.id | 1:1対応 |
| playstyle_tags | TEXT[] | | タグ配列 (例: {aggressive, explorer}) |
| personality_data | JSONB | | 性格診断結果など |
| preference_vector | FLOAT8[] | | 嗜好分析ベクトル |
| preference_version | INTEGER | DEFAULT 0 | ベクトルのバージョン |
| updated_at | TIMESTAMPTZ | NOT NULL | 最終更新 |

### 4.4 play_sessions

| カラム | 型 | 制約 | 説明 |
|--------|-----|------|------|
| id | UUID | PK | セッションID |
| user_id | UUID | FK → users.id | プレイヤー |
| game_id | VARCHAR(100) | NOT NULL | ゲーム識別子 |
| started_at | TIMESTAMPTZ | NOT NULL | セッション開始 |
| ended_at | TIMESTAMPTZ | | セッション終了 |
| metadata | JSONB | | クライアント情報等 |

### 4.5 play_events

| カラム | 型 | 制約 | 説明 |
|--------|-----|------|------|
| id | BIGSERIAL | PK | イベントID |
| session_id | UUID | FK → play_sessions.id | 所属セッション |
| event_type | VARCHAR(100) | NOT NULL | イベント種別 (例: level_clear) |
| event_data | JSONB | NOT NULL | イベントペイロード |
| occurred_at | TIMESTAMPTZ | NOT NULL | 発生日時 |

### 4.6 surveys

| カラム | 型 | 制約 | 説明 |
|--------|-----|------|------|
| id | UUID | PK | アンケートID |
| title | VARCHAR(255) | NOT NULL | タイトル |
| description | TEXT | | 説明 |
| questions | JSONB | NOT NULL | 設問定義 (JSON Schema準拠) |
| is_active | BOOLEAN | DEFAULT true | 有効フラグ |
| created_at | TIMESTAMPTZ | NOT NULL | 作成日時 |

### 4.7 survey_responses

| カラム | 型 | 制約 | 説明 |
|--------|-----|------|------|
| id | UUID | PK | 回答ID |
| survey_id | UUID | FK → surveys.id | 対象アンケート |
| user_id | UUID | FK → users.id | 回答者 |
| answers | JSONB | NOT NULL | 回答データ |
| submitted_at | TIMESTAMPTZ | NOT NULL | 提出日時 |

---

## 5. API設計

全APIはRESTに準拠し、JSONをリクエスト/レスポンスボディとする。ベースパス: `/api/v1`

### 5.1 認証 API

| Method | Path | 説明 | 認証 |
|--------|------|------|------|
| GET | `/auth/login` | OAuth2認証フロー開始 (providerクエリ必須) | — |
| GET | `/auth/callback` | IdPコールバック処理 | — |
| POST | `/auth/ticket` | one-time login ticketをVoluptas JWTへ交換 | — |
| POST | `/auth/token` | code + code_verifierでトークン取得 | — |
| POST | `/auth/refresh` | refresh_tokenでaccess_token再発行 | — |
| POST | `/auth/logout` | トークン失効化 | Bearer |
| GET | `/auth/.well-known/jwks.json` | JWKS公開鍵配信 | — |

### 5.2 ユーザー / プロフィール API

| Method | Path | 説明 | 認証 |
|--------|------|------|------|
| GET | `/api/v1/users/me` | 自分のユーザー情報取得 | Bearer |
| PATCH | `/api/v1/users/me` | ユーザー情報更新 (display_name, avatar_url等) | Bearer |
| DELETE | `/api/v1/users/me` | アカウント削除 (論理削除、発行5分以内のBearer必須) | Bearer |
| GET | `/api/v1/users/me/identities` | 連携IdP一覧 | Bearer |
| POST | `/api/v1/users/me/identities` | 新規IdP連携追加 | Bearer |
| DELETE | `/api/v1/users/me/identities/:provider` | IdP連携解除 | Bearer |
| GET | `/api/v1/users/me/profile` | プレイスタイル・嗜好情報取得 | Bearer |
| PUT | `/api/v1/users/me/profile` | プロフィール更新 | Bearer |
| GET | `/api/v1/users/:id/profile` | 他ユーザーの公開プロフィール取得 | Bearer |

### 5.3 ロギング API

| Method | Path | 説明 | 認証 |
|--------|------|------|------|
| POST | `/api/v1/sessions` | プレイセッション開始 | Bearer |
| PATCH | `/api/v1/sessions/:id` | セッション終了 (ended_at設定) | Bearer |
| POST | `/api/v1/sessions/:id/events` | イベント送信 (単一) | Bearer |
| POST | `/api/v1/sessions/:id/events/batch` | イベントバッチ送信 | Bearer |
| GET | `/api/v1/sessions` | 自分のセッション一覧 (pagination) | Bearer |
| GET | `/api/v1/sessions/:id/events` | セッションのイベント一覧 | Bearer |

### 5.4 アンケート API

| Method | Path | 説明 | 認証 |
|--------|------|------|------|
| GET | `/api/v1/surveys` | アクティブなアンケート一覧 | Bearer |
| GET | `/api/v1/surveys/:id` | アンケート詳細取得 | Bearer |
| POST | `/api/v1/surveys/:id/responses` | 回答提出 | Bearer |
| GET | `/api/v1/surveys/:id/responses/me` | 自分の回答取得 | Bearer |

### 5.5 共通レスポンスフォーマット

全APIレスポンスは以下のエンベロープに従う:

```json
// 成功
{ "ok": true, "data": { ... } }

// エラー
{ "ok": false, "error": { "code": "VALIDATION_ERROR", "message": "..." } }
```

| HTTP Status | 用途 |
|-------------|------|
| 200 | 成功 |
| 201 | リソース作成成功 |
| 400 | バリデーションエラー |
| 401 | 未認証 |
| 403 | 権限不足 |
| 404 | リソース未検出 |
| 429 | レートリミット超過 |
| 500 | 内部エラー |

---

## 6. 嗜好分析基盤

### 6.1 分析アーキテクチャ

ゲームプレイログとアンケート回答の両方を入力とし、ユーザーごとの嗜好ベクトル (Preference Vector) を生成する。分析は非同期ジョブとして実行され、結果は `player_profiles` テーブルに書き戻される。

#### 分析パイプライン

| ステップ | 内容 | トリガー |
|----------|------|----------|
| 1. イベント集約 | `play_events` を集計し、特徴量を抽出 | セッション終了時 |
| 2. アンケート統合 | `survey_responses` をスコア化 | 回答提出時 |
| 3. ベクトル計算 | 集約データを統合し、正規化ベクトルを計算 | Step 1/2完了時 |
| 4. タグ付与 | ベクトルから主要特性タグを自動付与 | Step 3完了時 |
| 5. プロフィール更新 | `player_profiles` に `preference_vector` + tags を書き戻し | Step 4完了時 |

### 6.2 嗜好軸 (Preference Dimensions)

プレイスタイルを多軸で捕捉する。初期バージョンでは以下の軸を定義する (Bartle Taxonomy拡張):

| 軸 (index) | 名称 | 説明 | 入力ソース |
|-------------|------|------|-----------|
| 0 | Achievement (達成志向) | 目標達成、スコア、完了率への関心 | ログ + アンケート |
| 1 | Exploration (探索志向) | マップ探索、隠し要素発見 | ログ |
| 2 | Social (社交志向) | マルチプレイ、チャット、協力 | ログ + アンケート |
| 3 | Competition (競争志向) | PvP、ランキング、勝率への執着 | ログ |
| 4 | Creativity (創造志向) | ビルド、カスタマイズ、UGC | ログ + アンケート |
| 5 | Narrative (物語志向) | ストーリー進行、会話選択、世界観理解 | ログ + アンケート |
| 6 | Intensity (没入度) | プレイ時間、セッション頻度、集中度 | ログ |
| 7 | Mastery (習熟志向) | 難易度選択、リトライ回数、スキル上達曲線 | ログ |

### 6.3 イベントタイプ定義例

ゲームクライアントが送信するイベントの `event_type` 規約:

| event_type | 説明 | 関連軸 | event_data例 |
|------------|------|--------|-------------|
| `level_clear` | ステージクリア | Achievement, Mastery | `{ "level": 5, "time_sec": 120, "retries": 2 }` |
| `area_discover` | 新エリア発見 | Exploration | `{ "area_id": "forest_north", "pct": 0.3 }` |
| `pvp_match` | 対人戦結果 | Competition, Social | `{ "result": "win", "opponent": "..." }` |
| `build_create` | クリエイティブ制作 | Creativity | `{ "type": "house", "blocks": 240 }` |
| `dialog_choice` | 会話選択肢 | Narrative | `{ "npc": "elder", "choice_idx": 2 }` |
| `session_heartbeat` | 定期パルス | Intensity | `{ "active_sec": 300 }` |

### 6.4 アンケート questions スキーマ例

アンケートの `questions` フィールドはJSON配列で、各要素が1つの設問を表す:

```json
{
  "id": "q1",
  "type": "scale",
  "text": "難しいチャレンジを好みますか？",
  "dimension": "mastery",
  "options": { "min": 1, "max": 5 }
}
```

| type | 説明 |
|------|------|
| `scale` | リッカート尺度 (min〜max) |
| `choice` | 単一/複数選択 |
| `freetext` | 自由記述 |

---

## 7. セキュリティ

| 領域 | 対策 |
|------|------|
| 通信 | TLS 1.3必須、HSTSヘッダー |
| 認証トークン | RS256署名 JWT、短寿命access_token + ローテーション付きrefresh_token |
| CSRF | SameSite=Strict Cookie + CSRFトークン (ブラウザクライアント時) |
| レートリミット | エンドポイント別に設定。ログイン試行: 5回/分、イベント送信: 100回/分 |
| 入力検証 | 全エンドポイントでJSON Schemaバリデーション |
| データ暗号化 | **未実装**。現行`raw_profile`はallowlistで最小化。カラムレベル暗号化は別タスク |
| GDPR/個人情報 | `DELETE /users/me`は論理削除。Discutereへexport済み疑似IDデータは削除範囲外（法務判断未確定） |
| ロギング | アクセスログにPIIを含めない。SIDのみ記録 |

---

## 8. 非機能要件

| 項目 | 要件 |
|------|------|
| 可用性 | 99.9% uptime (API Gatewayのヘルスチェックで監視) |
| レイテンシ | APIレスポンス p95 < 200ms (ロギングAPIは p95 < 50ms) |
| スループット | ロギングAPI: 10,000 events/sec (batch endpoint) |
| スケーラビリティ | 水平スケール可能なステートレス設計 (セッションはDB管理) |
| データ保持 | play_events: 90日保持後アーカイブ、分析結果は無期限 |
| 監視 | Prometheus + Grafana、トレース: OpenTelemetry |
| デプロイ | Dockerコンテナ + Kubernetes (EKS / GKE) |

---

## 9. マイルストーン

| フェーズ | 内容 | 目安期間 |
|----------|------|----------|
| Phase 1 | Auth Service + User CRUD + DBスキーマ構築 | 2週間 |
| Phase 2 | Profile API + ロギングAPI (session/event) | 2週間 |
| Phase 3 | アンケートAPI + 嗜好分析エンジン v1 | 3週間 |
| Phase 4 | ダッシュボード + 運用監視 + 負荷テスト | 2週間 |

---

## 改訂履歴

| バージョン | 日付 | 内容 |
|------------|------|------|
| 1.0 | 2026-03-16 | 初版作成 |
| 1.1 | 2026-07-12 | OIDC OP表記をIdPフェデレーションへ訂正。login ticket、Redis state、Steam無効化、PII実装状況、Voluptas×Discutere統合を反映 |
