# 単発 Claude CLI の起動

Spec ID: SPEC-SHARED-ONE-SHOT

ClaudeCliTextClient は既存の player-profile-server/lib/lapilli submodule から @ludiars/one-shot を file: 依存で読み込む。CommonJS require に対応した共有パッケージを使い、Node 22.12 以上を維持する。初期化は既存の npm run setup:submodules を利用する。

共有層はモデル役割の解決、Windows 実行ファイルの解決、認証に関わる起動環境の整理を持つ。Claude CLI の既定は `sonnet` で、起動時に Concordia の対応表を参照する。対応表が無い場合は Lapilli がサポートする CLI エイリアスを使う。結果には起動引数に渡したモデルを記録し、明示モデル ID は維持する。shell は使用せず、プロンプトは stdin に限定する。

Voluptas は画像の一時ディレクトリとファイルごとの Read 制限、入力検証、タイムアウト、終了コードと空出力の判定を所有する。権限追加・リトライ・暗黙の API 切替は行わない。Anthropic API backend は既存の明示選択のまま。

llmTextClient.test.js は注入した子プロセスで stdin、shell 無効、画像権限、具体的モデル、起動・終了失敗を検証する。実 CLI やサービスは起動しない。復旧時は本変更と submodule 参照を一緒に revert する。
