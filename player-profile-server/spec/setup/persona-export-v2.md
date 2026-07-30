# Persona export v2

Research export is opt-in and defaults to off in both runtime modes.

## Local

1. Enable `ペルソナの研究提供（仮名化）に同意する` in Local Settings.
2. Set `VOLUPTAS_PSEUDO_ID_SECRET` to the stable HMAC secret.
3. Run `npm run export:personas`.

The command atomically replaces `<data repository>/exports/personas.jsonl`.
With consent off, it deliberately writes an empty file. Publication of the
private data repository remains an operator-controlled Git action; the export
command does not broaden existing remote-publish permission.

## Online

Set both:

- `VOLUPTAS_PSEUDO_ID_SECRET`: stable HMAC secret used for `pseudoId`.
- `VOLUPTAS_PERSONA_EXPORT_TOKEN`: dedicated, high-entropy inbound project
  credential shared only with the approved Di importer.

Request `GET /api/personas/export?limit=100`. Send the project credential as
`Authorization: Bearer <token>`. When `X-Next-Cursor` is present, repeat with
that value as the `cursor` query parameter.

The endpoint uses `application/x-ndjson`, `Cache-Control: private, no-store`,
and selects only non-deleted users with explicit research-export consent.
It does not accept ordinary user access tokens as batch-export authority.

## Discutere から母集団レポートを取り込む

Discutere の `npm run persona:populations -- --report <path>` が出力した
`population-report.json` を、同じ project credential でオンライン API に送る。

```text
POST /api/personas/population-report
Authorization: Bearer <VOLUPTAS_PERSONA_EXPORT_TOKEN>
Content-Type: application/json
```

1 リクエストは最大 5,000 行。大きなレポートは `generatedAt` と
`realPopulation` を維持して `entries` だけを分割する。Voluptas は研究提供に
同意したユーザーだけを仮名 ID で照合し、v2 分析の `population` を更新する。
ローカルモードではペルソナ画面の「母集団レポートを取込」から同じ JSON を選べる。
