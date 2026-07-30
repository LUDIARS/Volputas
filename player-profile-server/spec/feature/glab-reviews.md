# GLAB game reviews

GLAB のゲーム感想は、Voluptas のオンライン `voices` 証跡を正本として扱う。
各投稿は `recommend`、`glabProjectId`、`visibility`、`anonymous` を追加で保持する。

## API

すべて Cernere project token を必要とし、応答には
`Cache-Control: private, no-store` を付与する。

- `GET /api/v1/integrations/glab/reviews?projectId=&limit=&offset=`
  - `visibility: community` の投稿だけを返す。
  - `limit` は 1〜50、`offset` は非負整数。範囲外は 400 (`INVALID_PROFILE_INPUT`)。
  - 匿名投稿は表示名ではなく安定した pseudonymous ID を返す。
  - 投稿者 (`userId`) を持たない記録は、匿名化も帰属もできないため一覧から除外する。
- `POST /api/v1/integrations/glab/reviews`
  - token subject を投稿者として使用する。リクエスト本文の user ID は受け付けない。
  - `visibility` の既定値は `private` で、公開は明示的な opt-in とする。
  - 入力検証エラーは 400 (`INVALID_PROFILE_INPUT`) で返す。
- `GET /api/v1/integrations/glab/recent-games`
  - `steam_owned_games.playtime_2weeks_minutes > 0` の最近遊んだゲームを最大20件返す。

公開一覧は Cernere managed-project の `voice_records` を検索し、Voluptas の
ローカル DB へ複製しない。

## 保存と運用

- 投稿者はストア側 (`createForOwner`) で Cernere owner id を記録へ刻む。
  経路に依らず記録が自己記述的になり、payload による詐称もできない。
- 匿名投稿の pseudonymous ID は `VOLUPTAS_PSEUDO_ID_SECRET` から導出する。
  未設定の環境では匿名投稿を含む一覧が失敗するため、本 API を公開する
  デプロイでは必須。
