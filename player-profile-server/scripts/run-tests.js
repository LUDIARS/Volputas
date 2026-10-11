#!/usr/bin/env node
// 単体テストを周囲の環境変数から切り離して走らせる。
// Excubitor 配下で起動した審査ワーカーなどは他サービスの接続先 URL (http://<tailnet>) を
// 環境変数で受け取っている。config/index.js は読み込み時に接続先 URL を検査して例外を
// 投げるため、それらが漏れると設定を読む全テストが落ちる。テストは接続先を必要としない。
const { spawnSync } = require('node:child_process');

const VALIDATED_BASE_URL_ENV = ['CERNERE_BASE_URL', 'VOLUPTAS_AUDIENCE', 'VOLUPTAS_URL'];

const env = { ...process.env };
for (const name of VALIDATED_BASE_URL_ENV) delete env[name];

const patterns = process.argv.length > 2
  ? process.argv.slice(2)
  : ['src/**/*.test.js', 'desktop/**/*.test.js'];

const result = spawnSync(process.execPath, ['--test', ...patterns], { stdio: 'inherit', env });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
