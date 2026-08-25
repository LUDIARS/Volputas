# Voluptas game review → Discutere persona discussion

> Spec ID: `SPEC-VOLPUTAS-DISCUTERE-REVIEW-DISCUSSION`

## Goal

Voluptas で本人が保存したゲーム感想を、本人の明示操作で Discutere の議題にし、
Voluptas 由来の匿名本人ペルソナを必ず参加者に含める。

## Boundary

- 正本のゲーム感想と同意状態は Voluptas が保持する。
- Vo は `research_export_consent=true` かつ persona analysis v2 の affect vector が完成した本人だけを送る。
- Di へ送るのはゲーム名、1〜5評価、感想本文、既存 persona export v2 だけ。Voluptas user ID、表示名、
  impression/session ID は送らない。
- 自動 relay は行わない。レビュー詳細画面の本人操作だけを入口にする。
- endpoint は `DISCUTERE_PERSONA_BRIDGE_URL` を使い、固定 port を実装しない。

## Flow

1. `POST /api/v1/impressions/:id/discussions` が認証済み本人の所有権、review 状態、
   `client.source=volputas_web_game_review` を検証する。
2. Vo が既存 export v2 形式の匿名 persona を生成する。
3. Di の既存 `/api/admin/personas/import` に persona を冪等 import する。
4. 同じ pseudo ID から Di の canonical persona ID を決定的に導出する。
5. Di の既存 `/api/flow/start` にゲーム名・感想・評価と `personaIds=[本人persona]` を渡す。
6. Vo UI は Di session ID と、paper review が必要かを表示する。

## Failure policy

- 同意、解析、レビュー本文、設定の欠落は fail-fast し、汎用 persona へ黙って劣化しない。
- Vo→Di は redirect を許可せず、HTTPS または numeric loopback HTTP の既存 bridge 制約に従う。
- persona import が一件でも skip された場合は議論を開始しない。
