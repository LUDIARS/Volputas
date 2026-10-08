# 感想収集依頼の受付

仕様 ID: SPEC-IMPRESSION-COLLECTION-REQUEST

neco 2026-10-08 承認: Di に参考情報がない場合、Voluptas に依頼し、受付を待つか声なしで議論する。受付 API を追加する。

- `POST /api/personas/impression-requests` に `{requestId, theme}` を送る。
- 依頼元（検証済み service token の sub）と requestId の組で一度だけ保存する。同内容の再送は同じ受付を返す。異なる内容で同じ ID は 409。
- 保存後のみ `201 {ok:true,data:{request:{requestId,theme,status:"accepted",acceptedAt}}}` を返す。既存受付は 200。
- `GET /api/personas/impression-requests/:requestId` で同じ依頼元の受付を照合する。未受付は 404。他の依頼元の情報を返さない。
- `GET /api/personas/impression-requests` は依頼元の直近 100 件を返す。
- accepted は永続的な収集依頼の受領であり、人間の作業開始や感想の取得完了ではない。結果は既存の感想取得 API から参照する。
- 停止・ネットワーク障害・認証不足・DB 保存失敗は受付済みと見なさない。Di は通信失敗の際に Vo 停止中または接続不能を表示する。

認証: Cernere service token (aud=`volputas`) の `impression-requests:write` scope が必要。
`persona-export:read` および従来の固定 export token では受け付けない。Cernere の Di プロジェクト宣言に新 scope を追加する必要がある。

保存: `017_impression_requests.sql`、PostgreSQL の `impression_collection_requests`。既存の `predev` / `prestart` 移行で適用する。保存データは依頼元、依頼 ID、議題、受付状態・日時のみ。

この API は受付キューの契約であり、ゲームプレイ・感想投稿を自動生成しない。受け付けたことと収集の完了を区別して利用者へ知らせる。
