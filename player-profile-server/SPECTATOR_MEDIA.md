# Spectator media deployment

Spectator投稿はAPI processへ大容量データを通さず、非公開S3互換storageへ署名PUTし、別media workerが検査・変換します。

## 起動

1. `.env.example`の`MEDIA_S3_*`を設定する。
2. `npm run migrate`で`008_impression_reactions.sql`まで適用する。
3. APIを`npm start`で起動する。
4. ClamAV signatureを`freshclam`で更新する。
5. 別processまたは同じcontainer imageで`npm run worker:spectator-media`を起動する。

Docker imageにはFFmpeg、FFprobe、ClamAV、media worker scriptが含まれます。API containerとworker containerは同じimageを使い、worker側だけcommandを`npm run worker:spectator-media`へ変更できます。ClamAV signature databaseは永続volumeまたは定期`freshclam`で更新してください。

## 処理契約

- 予約時に種類・申告MIME・最大size・動画尺・SHA-256を検証する。
- 署名PUTは対象object keyとSHA-256 checksumへ拘束し、既定15分で失効する。
- complete時にS3 HEADのsize/checksumを予約値と照合する。
- workerはmagic bytes、ClamAV、FFprobeを通した後だけ処理する。
- 画像はmetadataを除去しthumbnailを作る。動画は先頭の映像と任意音声だけをH.264/AAC MP4へ変換する。
- 配信objectはprivateのまま、所有者認可後に既定5分の署名GETを返す。
- 原本は既定30日後に削除し、派生物は投稿削除時に削除する。
- 一時障害は指数backoffで最大5回、恒久的な形式・malware・変換失敗はrejectedへ遷移する。

workerは起動時に`ffmpeg -version`、`ffprobe -version`、`clamscan --version`を実行し、依存不足ならfail-fastします。APIはmedia設定不足時、添付付き投稿だけを`503 MEDIA_STORAGE_UNAVAILABLE`で拒否します。

### ローカル一括起動

Dockerが利用できる開発環境では、PostgreSQL、Redis、MinIO、migration、API、media workerをまとめて起動できます。

```bash
cp .env.media-dev.example .env.media-dev
npm run stack:media:config
npm run stack:media:up
```

APIは`http://127.0.0.1:53000`、MinIO S3 APIは`http://127.0.0.1:59000`、consoleは`http://127.0.0.1:59001`です。停止は`npm run stack:media:down`です。`.env.media-dev`の値はローカル専用であり、共有環境ではすべて変更してください。

コンテナ内部の`MEDIA_S3_ENDPOINT`とブラウザへ返す`MEDIA_S3_PUBLIC_ENDPOINT`は分離します。これによりworkerはCompose内のMinIOへ接続し、署名URLはホストブラウザから到達できます。

## Volputas 単体の動画レビュー

ログイン後の `Video Review` から、ローカルの MP4 / MKV / WebM をアップロードできます。上限は 200MB・2時間です。Spectator の直前リプレイ投稿は従来どおり30秒上限で、クライアントメタデータの `source` をサーバーが明示的に判定します。

動画が `ready` になった後、本人は再生位置に次のリアクションを記録できます。

- `comment`: 自由記述
- `positive`: ここ良かった
- `negative`: ここ悪かった

リアクションは `impression_reactions` に `video_offset_ms`、`kind`、本人入力の `content`、`recorded_at` を保存します。API は `GET/POST /api/v1/impressions/:id/reactions` と `DELETE /api/v1/impressions/:id/reactions/:reactionId` です。すべて既存の Volputas 認証を通し、対象 impression の所有者だけが操作できます。

`GET /api/v1/impressions/:id/reactions/raw` はSpectatorと同じ `spectator.reaction-raw/v2` 契約を返します。`POST /api/v1/impressions/:id/reactions/timeline` は現在の本人入力を既存の `video_comments` affect timelineへ集約・upsertします。Web画面からraw JSON保存と感情曲線生成を実行できます。
