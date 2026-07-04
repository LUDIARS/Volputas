# Player Profile Backend

ゲームプレイヤーのプレイスタイルや個性を登録・管理するバックエンドサーバーです。OpenID Connect 型認証、ゲームプレイロギング、嗜好分析基盤を提供します。

## 機能

- **認証・ユーザー管理** — OpenID Connect (Authorization Code Flow + PKCE) によるID発行、Google / Discord / Steam 連携
- **プレイヤープロフィール** — プレイスタイルタグ、性格診断データ、嗜好ベクトルの管理
- **ゲームプレイロギング** — イベント収集API、セッション管理、バッチ取り込み
- **アンケート基盤** — 設問定義・回答収集、リッカート尺度・選択式・自由記述に対応
- **嗜好分析エンジン** — プレイログとアンケートを統合し、8軸の嗜好ベクトル (Bartle Taxonomy 拡張) を自動生成

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
| 認証 | `GET /auth/login`, `POST /auth/token` | OAuth2フロー、トークン発行 |
| ユーザー | `GET /api/v1/users/me` | ユーザー情報CRUD |
| プロフィール | `GET /api/v1/users/me/profile` | プレイスタイル・嗜好情報 |
| ロギング | `POST /api/v1/sessions/:id/events` | ゲームイベント送信 |
| アンケート | `POST /api/v1/surveys/:id/responses` | アンケート回答提出 |
| 分析 | `GET /api/v1/analysis/me` | 嗜好分析結果取得 |

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
