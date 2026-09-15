# 外部コメント履歴からのペルソナ形成

仕様 ID: SPEC-VO-COMMENT-HISTORY-001。Di の SPEC-DI-COMMENT-HISTORY-001 と対になる。

Di が公式 API から収集した履歴 snapshot v1 を入力し、既存 sentiment-core v1 の
固定20次元を用いて、ペルソナブリッジ v2 が読める JSONL を生成する。
動画コメント・Steam は過去6暦月、ライブチャットは収集開始以降の範囲。

YouTube 動画コメントとライブチャットは channel ID の完全一致で統合する。
SteamID は別の名前空間。サービスを跨ぐ人物同定や名前からの推定はしない。
ID 不明、期限切れ、不正な期間、取得前のライブ発言は受け入れない。
同一 source/nativeId は最新版1件とし、投稿者が競合する入力は拒否する。

`buildVector(extractTextFeatures(...))` により同じ20次元定義を共有する。
人格、年齢、政治的立場等を推測して埋めない。ゲーム評価軸に根拠がない場合は
既存エンジンの中立値とし、それを嗜好が確定したという意味で使わない。
既定10件未満の話者は出力せず不足件数を報告する。この閾値は精度保証ではない。
全出力に実件数・観測月数・初回最終発言時刻・対象期間・有効期限・部分観測の表示を付ける。
実ユーザーの完全な人格や母集団代表性を保証しない。

既存の同意済み登録ユーザープロファイルとは別の取込口。
仮名キーは `external-history:<platform>:<authorId>` を既存の HMAC 関数へ渡して形成し、
登録ユーザーの SID と混同しない。元ID・名前・コメント本文・URLは出力しない。

YouTubeを含む入力には、運用者が用途の承認を確認したうえで
`VOLPUTAS_YOUTUBE_DERIVED_APPROVAL_REFERENCE` を設定する。
文字列を設定するだけでYouTubeの承認を取得したことにはならない。
承認未確認の段階ではYouTubeデータからの生成を実行しない。
Steamのみのsnapshotは別途処理できる。

実行（player-profile-server cwd）:

```sh
npm run import:comment-history -- <private-snapshot.json> <personas.jsonl> 10
```

`VOLPUTAS_PSEUDO_ID_SECRET` 必須。結果JSONLは Di の
`npm run persona:import -- --input <personas.jsonl>` に渡す。
Di側の期限管理対応と同時に導入する。元snapshotとJSONLは expiresAt までに削除する。
本コマンドは raw履歴や生成出力をサービスDBに自動保存しない。
