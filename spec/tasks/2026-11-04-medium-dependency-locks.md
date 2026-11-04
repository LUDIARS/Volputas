# 指定依存の非破壊更新

仕様 ID: SPEC-MEDIUM-DEPENDENCY-LOCKS

関連: actio:85b9d9bb-cf3f-4a92-890c-c6dfb1f75fba

継続対応: actio:ce9833a4-659b-46bd-a727-f1e29c350d6a / Revisor local PR #3599

overlay の mermaid 11.17.2 が要求する dompurify `^3.3.3` は 3.4.17 を許容する。
server の body-parser 1.20.8 が要求する qs `~6.16.0` は 6.16.2 を許容する。
この二つの lock entry の version / resolved / integrity のみを更新する。
公開 npm registry の版別メタデータを用い、親パッケージ・manifest・overrides は変更しない。

express 4.22.2 の qs 要求は `~6.15.1`（6.15.1 以上、6.16.0 未満）。
指定された 6.16.2 は範囲外のため、root の qs 6.15.3 は留保して維持する。
この残存箇所の既知脆弱性は本変更では解消しない。

## 受け入れ条件

C-1 inspectOverlayLock(lock): dompurify 3.4.17 を mermaid の既存要求 ^3.3.3 内で固定し公開 registry の整合性情報を保持する
C-2 inspectServerLock(lock): body-parser 配下の qs だけを既存要求 ~6.16.0 内の 6.16.2 に固定し express の ~6.15.1 と qs 6.15.3 を維持する

## 検証計画

`augur plan` の現状を固定する提案を、対象 lock entry と親要求の回帰テストに限定する。
実ファイルの契約を確認し、旧版・範囲外更新・integrity 改変を述語が拒否することを対で確認する。
差分の構造比較で、対象二 entry の三フィールド以外が不変であることを確認する。
依存追加、install/postinstall、サービス操作、全体テストは行わない。

復旧は二つの lock entry の三フィールドを変更前へ戻す。

## 再利用と依存の判断

既存の mermaid → dompurify、body-parser / express → qs の依存経路を再利用する。
DOM の無害化と複雑なクエリ解析は互換性を要するため自作へ置き換えない。
qs の二重配置は親の要求レンジが異なるため維持する。
修正版の依存・optionalDependencies は既存 entry と一致し、導入時スクリプトはない。
ライセンスも dompurify は MPL-2.0 OR Apache-2.0、qs は BSD-3-Clause のまま。
契約ランタイムは Augur の管理テンプレートを再利用し、独自の観測実装は追加しない。
取得通信は公開 npm registry の版別メタデータのみで認証情報・私有コードは送らない。
アプリ・修正版パッケージは実行せず、起動時通信や動的実行を追加しない。

## 検証結果

対象テスト 2 件成功。契約 C-1 / C-2 は各 1 回観測、違反 0 件。
Augur contracts lint は findings 0 件。
両 lockfile を変更前の JSON と構造比較し、対象 entry の version / resolved / integrity
以外が不変であることを確認した。全体テスト・インストール・サービス操作は未実施。

## 2026-11-05 の受入指摘対応

既存 PR の停止理由は契約コードの対象ドメイン未設定だったため、
`dependency-locks` を支援ドメインとして登録する。所有範囲は本更新の lockfile と
専用の検査・述語・回帰テスト・Augur 管理ランタイムに限定する。
ランタイムの処理、契約 C-1 / C-2、依存固定版、親要求は変更しない。
既存の `test-support` はアプリケーション用テスト共通土台を所有するため拡張せず、
依存固定版の整合性という変更理由に沿って境界を定義する。
今回の対応はドメイン定義と仕様参照のみで、テスト・インストール・サービス操作は実行しない。
