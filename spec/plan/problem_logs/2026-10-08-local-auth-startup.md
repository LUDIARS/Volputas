# Vo 起動時の認証接続先拒否

受付 API の起動確認で、Ex が配布した非 loopback HTTP の CERNERE_BASE_URL を
Vo の URL 検証が拒否し、predev の migration が起動前に終了した。

この端末の catalog は Cr と Vo を同居させるため、Vo の env に loopback の Cr 接続先と
自サービス URL を指定する。HTTPS / loopback 制限は緩めない。
ポート根拠は Cr / Vo が所有する excubitor.catalog.yaml。別端末へ配置するときは
接続先を HTTPS に設定し直す必要がある。

旧 Volputas checkout の catalog は重複定義だったため、同フォルダ内の
excubitor.catalog.yaml.retired-20261008 へ退避した。コード・データは削除していない。

初回の Ex 起動受付は成功したが health は接続拒否。起動成功とは扱わない。
