# rustls 固定版更新

Actio: `actio:ed716171-fd60-4e4a-adbb-8525048495d7`

既存の TLS 依存構成を再利用し、`overlay-app/src-tauri/Cargo.lock` の rustls を
0.23.44 から 0.23.46 へ更新する。Cargo.toml、features、他 crate は変更しない。
新しい overrides や実行時コードは不要。

C-3 inspectRustlsLock(lock, baseline, manifest, baselineManifest): rustls のみを公開 checksum の 0.23.46 に更新し他のロック内容と Cargo.toml を維持する

公開 crates.io の固定版メタデータで 0.23.46 が非 yanked、ライセンスが
`Apache-2.0 OR ISC OR MIT` であることを確認した。
親要求は hyper-rustls 0.27.9 が `^0.23`、quinn 0.11.11 と quinn-proto 0.11.17 が
`^0.23.5`、reqwest 0.12.28 が `^0.23.4`、tokio-rustls 0.26.5 が `^0.23.27`。
全て更新版を許す。直接依存の解決変更も不要。

Augur plan の現状境界を固定する提案に対し、契約と回帰テストを対で追加する。
検証は実ファイルと main 時点のロック・manifest の読み取り突合に限定する。
回帰テストは旧版、checksum 破損、無関係なロック変更、manifest 変更を拒否する。
指示に従いテスト・ビルド・起動・crate 取得は実行しない。
既存 C-1/C-2 の契約注入 orphan 警告は今回の対象外であり変更しない。
