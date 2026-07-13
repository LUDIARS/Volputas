# 代理入力とプロフィールclaim

## 目的と優先順位

Voluptas は、本人が操作を委任した相手から構造化プロフィール案を受け取れるようにする。
第三者の入力は本人の事実ではなく `claim` として隔離し、本人が個別承認した値だけを
`player_profiles` の正本へ反映する。優先順位は、本人の統制、機微情報の排除、監査可能性、利便性の順とする。

## 採用設計

1. 本人が許可フィールド・目的・期限・利用回数を指定して委任を作る。
2. API は一度だけ招待tokenを返し、DBにはSHA-256 hashだけを保存する。
3. 招待tokenを受け取った代理人が、自分のVoluptasアカウントで受諾する。
4. 代理人は許可範囲の構造化claimを提案する。本人のtokenやsubject権限は取得しない。
5. 本人はclaimを個別にaccept/rejectする。accept時だけ正本へ反映する。
6. 本人はいつでも委任を失効できる。期限・利用上限・競合時はdeny by defaultとする。

代理人は受諾前にtokenで目的・許可範囲・期限をpreviewでき、受諾後も自分から委任を離脱できる。

`subject_user_id`（本人）と`actor_user_id`（入力者）は全経路で分離する。再委任、本人承認なしの
確定、代理人によるプロフィール全体の読取、自由記述は初期版では提供しない。
招待tokenの応答には`Cache-Control: no-store`を付け、tokenはURLへ含めずPOST bodyで扱う。

## 入力可能なフィールド

- `playstyle_tags`: サーバー定義済み12タグだけ。任意文字列は禁止。
- `preference.<axis>`: 既存15軸だけ。値は有限数 `-1..1`。

病歴、障害、宗教、政治、性的指向、所在地、連絡先、外部ID、法的評価、人格断定などは
フィールド自体を定義しない。未知フィールドは入口で拒否する。

## 認証・認可

- 委任作成、受諾、失効、claim承認は発行5分以内のaccess tokenを要求する。
- claim提案はactiveな委任の`delegate_user_id`だけが行える。
- claim決定と委任失効は`subject_user_id`だけが行える。
- claim・監査の参照は本人または受諾済み代理人に限定する。
- 招待tokenは43文字以上の高エントロピー値とし、受諾・失効・期限切れでhashも削除する。

## 状態遷移

```text
grant: pending -> active -> revoked | expired
claim: pending -> accepted | rejected | withdrawn | cancelled | expired
```

期限処理は各委任APIの入口でトランザクション内に実行する。期限切れ・取消・却下・撤回claimの
生値は30日後に削除し、値を含まない監査イベントだけを残す。API入口の自己清掃に加えて
`npm run purge:delegation-claims`を日次実行し、休眠データにも保持期限を適用する。コマンドは削除件数だけを出力する。
本人または代理人のアカウントsoft delete時も、同一トランザクションで関係する委任を失効し、
pending claimを取消す。

## API

- `POST /api/v1/delegations`
- `GET /api/v1/delegations/schema`
- `POST /api/v1/delegations/accept`
- `POST /api/v1/delegations/preview`
- `GET /api/v1/delegations?direction=outgoing|incoming`
- `POST /api/v1/delegations/:id/revoke`
- `POST /api/v1/delegations/:id/leave`
- `POST /api/v1/delegations/:id/claims`
- `GET /api/v1/delegations/:id/claims`
- `POST /api/v1/delegations/claims/:claimId/decision`
- `POST /api/v1/delegations/claims/:claimId/withdraw`
- `GET /api/v1/delegations/:id/audit`

## Discutere境界

pending/rejected claim、代理人ID、委任理由、監査情報はDiscutereへexportしない。
既存のpersona exportは、本人承認後に正本へ反映されたplaystyle tagsと派生affectだけを対象とする。
