---
type: setup
title: "Build / test toolchain"
description: "Volputas backend / frontend のNode.js版数、test探索方法、CI jobの構成を定める。"
service: volputas
domain: tooling
tags:
  - setup
  - node-test-runner
  - github-actions
  - ci
status: implemented
related:
  - ../../../.github/workflows/ci.yml
  - ../../package.json
  - ../../frontend/package.json
  - ../../Dockerfile
updated: 2026-09-05
---

# Build / test toolchain

正本ソース: `.github/workflows/ci.yml` / `player-profile-server/package.json` /
`player-profile-server/frontend/package.json` / `player-profile-server/Dockerfile`

---

## 前提

- **Node.js 22 以上**。backend の `package.json` は、sentiment-core のテスト依存である
  Vite 8 に合わせて `engines.node` を `>=22.12.0` とする。frontend は
  `>=22.0.0`、CI の `actions/setup-node` は `node-version: 22`、実行 image は
  `node:22-alpine`。これらは必ず同じmajorに揃える (CIが実際にshipされるruntimeを
  検証するため)。frontendにも `engines` を置くのは、下のtest scriptがNode 22の
  glob解決に依存しているため。
- Node.js 20 は 2026-04 に EOL 済みで、下限としては採用しない。
- backendのtestは Node 標準 test runner (`node --test`) のみを使う。testing
  frameworkの追加依存は持たない。frontendも同じく `node --test` を使う。

## テストファイルの探索

backend / frontend いずれも glob patternを **quoteして** `node --test` に渡す。

| package | script |
|---|---|
| `player-profile-server` | `node --test "src/**/*.test.js" "desktop/**/*.test.js"` |
| `player-profile-server/frontend` | `node --test "src/**/*.test.js"` |

quoteが必須である理由:

- quoteを外すとglobを展開するのはshellであり、`node` ではない。POSIX shellは
  既定で `globstar` が無効なため `src/**/*.test.js` は `src/*/*.test.js` と等価に
  なり、**ちょうど1階層下のtestだけ**が実行される。直下 (`src/foo.test.js`) や
  深い階層 (`src/a/b/foo.test.js`) のtestは**エラーを出さずに黙って除外**され、
  CIはgreenのままsuiteが縮む。
- Windows (`cmd.exe`) はそもそもglobを展開しないため、quote無しではpatternが
  literalのままNodeへ渡り、ローカルの `npm test` が失敗する。
- quoteするとNode 22内蔵のglob解決が使われ、`**` は0階層以上にmatchするので
  全階層のtestが対象になる。この挙動はNode 22前提であり、`engines.node` の
  下限を下げる場合はこのscriptも同時に見直すこと。

testを追加するときにscriptの編集は不要。上記patternに合う位置へ置けばよい。

## CI job (`.github/workflows/ci.yml`)

`push` (main) と `pull_request` (main宛) で `ubuntu-latest` 上を1 jobで直列実行する。

1. `actions/checkout@v4` (`submodules: false`)
2. public code submoduleのみ取得 — `player-profile-server/lib/lapilli`
3. `actions/setup-node@v4` — Node 22 + npm cache
   (`player-profile-server/package-lock.json` と `frontend/package-lock.json`)
4. `npm run setup:submodules -- --skip-git-update` — sentiment-core を build
5. backend: `npm ci` → `npm test`
6. frontend: `npm ci` → `npm run build` → `npm test`

`permissions: contents: read` のみ。CIはsecretを要求せず、外部serviceへ接続しない。

## 実行 image (`Dockerfile`)

2-stage build。`node:22-alpine` でfrontendを `vite build` した `dist/` を、同じ
`node:22-alpine` のruntime stageへ `COPY --from` する。runtime stageは
`npm ci --omit=dev` の前に `lib/lapilli/packages/sentiment-core` を build する
(file: dependencyがsourceのみをshipするため)。
