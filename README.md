# Player Profile Backend

Spectatorの投稿・署名URL・media worker運用は[こちら](./player-profile-server/SPECTATOR_MEDIA.md)を参照してください。

ゲームプレイヤーのプレイスタイルや個性を登録・管理するバックエンドサーバーです。IdPフェデレーション + 自サービスJWT、ゲームプレイロギング、嗜好・感情分析基盤を提供します。

## 機能

- **認証・ユーザー管理** — Google / Discordフェデレーション、one-time login ticket、RS256 JWT。SteamはOpenID 2.0専用実装まで無効
- **プレイヤープロフィール** — プレイスタイルタグ、性格診断データ、嗜好ベクトルの管理
- **ゲームプレイロギング** — イベント収集API、セッション管理、バッチ取り込み
- **アンケート基盤** — 設問定義・回答収集、リッカート尺度・選択式・自由記述に対応
- **嗜好・感情分析** — 既存12次元嗜好、独立15軸質問票、Discutere互換20次元affectを併記
- **viewer reaction timeline** — 動画内時刻付きコメントを30秒ビンへ集約し、ビートごとの意図一致度とDesignGapを算出
- **ゲームレビュー** — 開発作品・市販作品を共通のsession/impression形式で5段階評価・投稿
- **動画レビュー** — Volputas 単体で録画済み動画をアップロードし、本人が「ここ良かった／ここ悪かった／コメント」を再生位置へ記録

## 技術スタック

### バックエンド

- **Runtime:** Node.js >= 20
- **Framework:** Express 4
- **Database:** PostgreSQL + Redis (cache)
- **認証:** JWT (RS256) + JWKS

### フロントエンド

- **React 19** + React Router 7
- **Vite 6** (ビルド・開発サーバー)

## セットアップ

### 前提条件

- Node.js 20 以上
- PostgreSQL
- Redis (キャッシュ用、オプション)

### バックエンド

```bash
cd player-profile-server
npm run setup:submodules  # checkoutがsubmodule取得済みなら末尾に -- --skip-git-update
npm install
npm run migrate   # DBマイグレーション実行
npm run dev       # 開発サーバー起動
```

### フロントエンド

```bash
cd player-profile-server/frontend
npm install
npm run dev       # Vite開発サーバー起動
```

## API概要

ベースパス: `/api/v1`

| カテゴリ | エンドポイント例 | 説明 |
|----------|------------------|------|
| 認証 | `GET /auth/login`, `POST /auth/ticket`, `POST /auth/token` | IdPフェデレーション、トークン発行 |
| ユーザー | `GET /api/v1/users/me` | ユーザー情報CRUD |
| プロフィール | `GET /api/v1/users/me/profile` | プレイスタイル・嗜好情報 |
| ロギング | `POST /api/v1/sessions/:id/events` | ゲームイベント送信 |
| 動画レビュー | `POST /api/v1/sessions/:id/impressions` | 動画アップロード予約 |
| 動画リアクション | `GET/POST /api/v1/impressions/:id/reactions` | 本人の時刻付きスタンプ一覧・追加 |
| リアクションraw data | `GET /api/v1/impressions/:id/reactions/raw` | Spectator互換のversioned self-report JSON |
| リアクション感情曲線 | `POST /api/v1/impressions/:id/reactions/timeline` | 現在の本人入力をaffect timelineへ集約・保存 |
| アンケート | `POST /api/v1/surveys/:id/responses` | アンケート回答提出 |
| 代理入力 | `POST /api/v1/delegations`, `POST /api/v1/delegations/:id/claims` | 本人招待・構造化claim・個別承認 |
| 分析 | `GET /api/v1/analysis/me` | 12次元 + 15軸 + 20次元の統合プロファイル |
| 感情曲線 | `GET /api/v1/games/:gameId/timelines` | viewer reaction timeline一覧 |
| ビート | `PUT /api/v1/games/:gameId/beat-script` | versioned beat script追加 |
| Gap | `GET /api/v1/games/:gameId/timelines/:id/gap` | ビート別matchScore + gapTop |

代理入力は本人のプロフィールへ直接書き込まず、期限・項目範囲付きの委任に基づくclaimとして保存する。
本人が個別に承認した値だけが正本へ反映される。詳細は
[代理入力とプロフィールclaim](./player-profile-server/spec/feature/delegated-profile-claims.md)を参照。

### 動画コメントから感情曲線を生成する

Discutereがexportした`ExternalUtterance[]`（`videoOffsetMs`付き）を用意し、次を実行する。

```bash
npm run import:timeline -- comments.json --game journey --source-ref sm9 --bin-ms 30000
```

Bearer tokenでビートスクリプトを登録後、Gap APIを呼ぶ。`intended_affect`はsentiment-core同梱24語のみ、時刻対応は`markers.t_hint_ms: [startMs,endMs]`で手動指定する。コメント語彙のヒット率はtimelineの`analysis_meta.lexiconHitRate`で確認できる。

詳細は [設計書](./player-profile-backend-design.md) を参照してください。

Ludellus / Ludellus-Server のプレイログ設計 (能力推定・ゲームチューニング・サジェスト基盤) は [Ludellus プレイログ設計書](./ludellus-tuning-log-design.md) を参照してください。

## プロジェクト構成

```
player-profile-server/
├── src/
│   ├── routes/        # APIルート定義
│   ├── models/        # DBスキーマ・リポジトリ
│   ├── services/      # ビジネスロジック (分析エンジン等)
│   ├── middleware/     # 認証・バリデーション・エラーハンドリング
│   └── config/        # 設定ファイル
├── migrations/        # DBマイグレーション
├── frontend/          # React SPA
│   └── src/
│       ├── pages/     # ページコンポーネント
│       ├── components/# 共通コンポーネント
│       ├── hooks/     # カスタムフック
│       └── lib/       # APIクライアント等
└── Dockerfile
```

## ライセンス

[MIT](./LICENSE) © 2026 LUDIARS
