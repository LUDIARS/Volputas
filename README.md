# Volputas

ゲームアンケート、ゲームプレイ情報、ユーザの声、動画上の感情曲線、ペルソナ分析を
扱うプレイヤーリサーチツールです。同じReact UIを、Git-backedのローカルモードと
Cernere認証を使うオンラインモードで利用できます。既定のExcubitor起動は無認証の
ローカルモードです。

## データモード

| モード | 認証 | データの正本 |
|---|---|---|
| ローカル | なし | 指定したVolputasData Gitリポジトリ |
| オンライン | Cernere OIDC | Cernereの`volputas` managed project |

オンラインでは、アンケート回答、ゲームプレイ情報、ユーザの声、感情曲線、
ペルソナ分析、メディア参照情報をCernereが所有します。スクリーンショットと動画の
バイト列だけは、巨大なバイナリをJSONへ格納しないためVolputasの保護ストレージへ置き、
Cernere側の所有者・種別・サイズ・参照情報を通さない限り取得できません。

オンライン起動に必要な設定は次のとおりです。

```dotenv
CERNERE_BASE_URL=https://cernere.example.com
CERNERE_PROJECT_CLIENT_ID=...
CERNERE_PROJECT_CLIENT_SECRET=...
CERNERE_OIDC_CLIENT_ID=...
CERNERE_OIDC_CLIENT_SECRET=...
CERNERE_OIDC_CALLBACK_URL=https://volputas.example.com/auth/callback
FRONTEND_URL=https://volputas.example.com
AUTH_SOURCES=cernere
VOLPUTAS_MEDIA_ROOT=/var/lib/volputas/profile-media
```

Cernere側へ`migrations/036_volputas_survey_responses.sql`と
`037_volputas_profile_evidence_schema.sql`を適用し、Volputas用project credentialsと
OIDC clientを発行してから設定します。`npm start`とDockerイメージは共通React UIも
ビルド・配信します。

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
- **ローカルアンケート** — PostgreSQL/JWT不要。独立cloneしたVolputasDataへ回答をローカル保存
- **Corpus連携** — GLABのCorpus frontend panelへCernere project-token保護APIを提供
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
```

backendの起動・再起動はプロジェクト本体folderからExcubitor経由で行う。
Excubitorの`npm run dev`実行前に`predev`がDB migrationを適用し、失敗時はlistenしない。
worktree、複製folder、直接の`npm run dev`からサービスを起動しない。

### DBなしでアンケートに回答する

ローカル経路はVolputas serverを起動しない。Node.js 20、Git、GitHub CLIが必要で、
GitHub CLIの現在の認証ユーザーを本人として扱う。`setup:survey-data` は公開データ
リポジトリ `LUDIARS/VolputasData` を `private/survey-data` へ独立cloneする。
これはsubmoduleではなく、Volputas本体のgitlinkにも記録されない。

```bash
cd player-profile-server
gh auth login
npm run setup:survey-data
npm run survey:local
```

既定動作は、設問定義と回答をOKF v0.1 Markdownとして独立clone内へ生成する。
個人回答はcloneの `.gitignore` 対象で、remoteへのcommit/pushは禁止される。
token、email、raw profileは保存しない。JSONファイルから回答する場合:

```bash
npm run survey:local -- --answers ./answers.json
```

`--save-only` は互換性のため受理するが、指定の有無にかかわらずlocal-onlyで動作する。

詳細は
[local-only OKF survey](./player-profile-server/spec/feature/local-okf-survey.md)と
[setup guide](./player-profile-server/spec/setup/local-okf-survey.md)を参照。

### フロントエンド

```bash
cd player-profile-server/frontend
npm install
npm run dev       # Vite開発サーバー起動
```

Voluptas backendとfrontendは別package・別buildである。ExcubitorのVoluptas backend componentは
frontendをbuild/serveしない。Corpus上のレビューUIはGLAB plugin pack
`plugins/volputas/`が所有し、Voluptasには
`/api/v1/integrations/glab/surveys`だけで接続する。standalone React frontendは
Voluptas単体利用向けに独立して残す。

### Corpus / GLAB

Voluptasは認証不要の`/.well-known/corpus-service.json`を公開する。GLAB connectorは
Excubitor topologyの`VOLPUTAS_URL`からbackendへ接続し、Cernere user access tokenを
`projectKey=volputas`の短命PASETOへ交換して転送する。

Voluptas側では`CERNERE_BASE_URL`と`VOLPUTAS_AUDIENCE`を公開設定として使い、
`CERNERE_PROJECT_CLIENT_ID` / `CERNERE_PROJECT_CLIENT_SECRET`はExcubitorが起動ごとに
注入する。実credentialを`.env`やrepositoryへ保存しない。詳細は
[Corpus survey integration](./player-profile-server/spec/feature/corpus-survey-integration.md)を参照。

## API概要

ベースパス: `/api/v1`

| カテゴリ | エンドポイント例 | 説明 |
|----------|------------------|------|
| 認証 | `GET /auth/login`, `POST /auth/ticket`, `POST /auth/token` | IdPフェデレーション、トークン発行 |
| ユーザー | `GET /api/v1/users/me` | ユーザー情報CRUD |
| プロフィール | `GET /api/v1/users/me/profile` | プレイスタイル・嗜好情報 |
| ロギング | `POST /api/v1/sessions/:id/events` | ゲームイベント送信 |
| アンケート | `POST /api/v1/surveys/:id/responses` | アンケート回答提出 |
| Corpusレビュー | `GET /api/v1/integrations/glab/surveys` | Cernere本人認証済みの設問一覧・回答 |
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
