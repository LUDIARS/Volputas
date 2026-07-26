# Player Profile Backend

ローカル専用アンケートツールです。従来のIdPフェデレーション、ゲームプレイロギング、
嗜好・感情分析バックエンドも同じリポジトリ内に残していますが、既定のExcubitor起動は
無認証のローカルモードを使用します。

## ローカル専用アンケート

既定のVolputasは、Cernere・OAuth・PostgreSQLを使わないローカルツールとして
Excubitorから起動する。初回起動後にSettingsで次を設定する。

- 任意のGitHubリポジトリをcloneした、データリポジトリの絶対パス
- 回答フォルダに使うName（Git Authorから自動設定）

設定保存時に対象リポジトリの`git config user.name`と`user.email`を検証する。
標準アンケートが未作成なら`surveys/gamer-preference.json`へ作成し、既存JSONは
上書きしない。画面はデータリポジトリ内の`surveys/*.json`をすべて読み込み、
アンケート一覧として表示する。

回答は次の構造で保存する。

```text
Volputas-Data/
├── surveys/
│   └── gamer-preference.json
└── answers/
    └── <Name>/
        └── gamer-preference.json
```

回答JSONにはNameとGit Authorを記録する。アプリは自動commit/pushを行わないため、
レビュー後に通常のGitフローでデータリポジトリへ反映する。

Nameはデータリポジトリの`git config user.name`から自動設定する。
一覧の回答状態は`answers/<Name>/<survey-id>.json`の存在から算出する。
回答ファイルがあれば`answered`、なければ`unanswered`とし、状態だけを保存する
別ファイルは作成しない。

## デスクトップ版

Electron版はGit CLIがPATHから実行できることを確認し、選択したVolputasData
リポジトリの`git config user.name`を回答フォルダのNameへ自動設定する。
Git AuthorのNameとEmail、GitHubのorigin remoteが不足している場合は設定を保存しない。

```sh
cd player-profile-server
npm ci --include=dev
npm run desktop:make
```

WindowsではSquirrelインストーラー、macOS/LinuxではZIPを作成する。
VolputasDataのcloneと設定JSON作成をまとめたサンプルは次に置く。パッケージ版にも
`resources/setup-samples`として同梱する。

- Windows: `desktop/setup-samples/setup-volputas-data.ps1`
- macOS / Linux: `desktop/setup-samples/setup-volputas-data.sh`

公開GitHub Releasesを更新元として、パッケージ版は起動時と10分ごとに更新を確認する。
自動更新対象はElectronが対応するWindowsとmacOS。macOSの更新配布には署名が必要。
`npm run desktop:publish`はGitHub Releaseをドラフト作成するため、成果物確認後に公開する。

## 機能

- **認証・ユーザー管理** — Google / Discordフェデレーション、one-time login ticket、RS256 JWT。SteamはOpenID 2.0専用実装まで無効
- **プレイヤープロフィール** — プレイスタイルタグ、性格診断データ、嗜好ベクトルの管理
- **ゲームプレイロギング** — イベント収集API、セッション管理、バッチ取り込み
- **アンケート基盤** — 設問定義・回答収集、リッカート尺度・選択式・自由記述に対応
- **嗜好・感情分析** — 既存12次元嗜好、独立15軸質問票、Discutere互換20次元affectを併記
- **viewer reaction timeline** — 動画内時刻付きコメントを30秒ビンへ集約し、ビートごとの意図一致度とDesignGapを算出

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
