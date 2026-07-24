---
type: plan
title: "Corpus survey integration"
description: "Voluptas backendとCorpus/GLAB frontendをAPI境界で分離し、Cernere本人認証でアンケートを接続する設計。"
service: voluptas
domain: survey
tags:
  - corpus
  - glab
  - cernere
  - backend
  - frontend
status: implemented
related:
  - ../feature/corpus-survey-integration.md
  - ../interface/corpus-survey-backend.md
  - ../setup/corpus-survey-integration.md
  - ../test/corpus-survey-integration.md
  - ../data/data-schema.md
updated: 2026-07-24
---

# Corpus survey integration

## 背景とゴール

GLABのCorpus plugin packには、Voluptasのアンケートを表示・回答するfrontend panelがある。
一方、Voluptasのbackendには、そのpanelが要求するCernere認証済みAPIがまだない。

この変更では責務を次の境界へ固定する。

- **frontend**: GLABの`plugins/volputas/`がCorpus panelを描画する。
- **backend**: Voluptasが設問catalog APIを提供し、Cernere本人回答へ接続する。
- **identity / response store**: Cernereが本人IDとCorpus回答の正本を持つ。
- **local survey**: GitHub CLI本人性とprivate OKF repositoryを使う既存CLIは独立して維持する。

## 目的と重視点

目的は、追加のVoluptasログインやSPA遷移なしに、Corpus上でVoluptasアンケートを扱えるように
すること。優先順位は次のとおり。

1. Cernere project-tokenのaudience・project・本人subjectをfail closedで検証する。
2. backendとfrontendのbuild/runtime責務を混ぜない。
3. 設問と回答の権威ソースを二重化しない。
4. local OKF回答とCorpus回答を暗黙にdual-writeしない。

## 採用アーキテクチャ

```text
Corpus shell
  └─ GLAB plugins/volputas panel (frontend)
       └─ GLAB connector / proxy
            ├─ Cernere: user access token → Voluptas向けproject-token
            └─ Voluptas backend: /api/v1/integrations/glab/surveys
                 ├─ Voluptas PostgreSQL: 公開対象の設問catalog
                 └─ Cernere project WebSocket: 本人回答の参照・保存
```

Voluptasは`/.well-known/corpus-service.json`も公開する。これはCorpusの共通service contractを
満たすためのbackend宣言であり、panel artifactは宣言しない。表示責務はGLAB plugin pack側に
置く。

## backend / frontend分離

- VoluptasのExcubitor backend componentはfrontend buildを実行しない。
- Voluptas backendはstandalone React SPAを配信しない。
- Voluptas repository内の既存React packageはstandalone clientとして独立build可能なまま残す。
- Corpus利用時のfrontend正本はGLAB plugin packであり、Voluptas backendとはHTTP JSON contract
  だけで結合する。

## データ判断

| データ | 権威ソース | 理由 |
|---|---|---|
| Corpus公開アンケート設問 | Voluptas PostgreSQL | アンケートdomainをVoluptasへ集約するため |
| Corpus回答・回答済み状態 | Cernere | 本人データとopt-outをCernereへ集約するため |
| local OKF回答 | private `Voluptas-Data` branch | local-only/GitHub本人性の既存契約を維持するため |

Cernere `sub`とGitHub numeric IDは異なるidentity domainである。自動照合や自動移送は行わない。

## 非ゴール

- local OKF responseのHTTP公開、parser/importer、Corpusへの自動同期
- Voluptas standalone React SPAのCorpus内mount
- Corpus本体へのVoluptas固有コード追加
- CernereまたはGLABの既存schema/plugin実装の複製

## ロールバック

追加routeとmigration columnは加算的である。接続を止める場合はGLABの`VOLPUTAS_URL`を未設定に
してdegraded表示へ戻す。DB columnやCernere回答tableは削除しない。
