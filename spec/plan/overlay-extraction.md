# ウインドウ表示拡張ツールの切り離し設計 (実施しない・設計のみ)

> 状態: 設計 (2026-08-21)。neco 指示「このツールって Volputas 以外でも使いそう。
> ちょっと切り離しを考える。今はやらない。設計だけ」。
> 対象: `overlay-app/` (`SPEC-WINDOW-OVERLAY-EXTENSION`)。
> **この文書は着手指示ではない。** 実施条件は §実施時期 を参照。

## なぜ切り離せるのか

`overlay-app/` は 2 層が同居している。

| 層 | 中身 | Volputas への依存 |
|---|---|---|
| 汎用 | OS 別ウインドウ追従、クリック透過、配置計算 (`placement` / `surface`)、Markdown 描画、グラフフェンスの差し込み口、プロファイル設定 | **無い** |
| 固有 | 感想マーカー投下 (`capture-session` API)、ホットスポット/ナラティブアークのデータ源、Volputas 用チャート実装 | **有る** |

汎用層は「任意のアプリのウインドウに情報を重ねる」以上のことを知らない。Volputas を消しても
成立する。切り離せるのはこの境界がすでに引かれているからで、新たに引き直す作業ではない。

## 切り離しの形

**新規リポジトリ 1 本 + Volputas 側は薄いアダプタ**にする。

```
Fenestra (新リポジトリ)
  crates/fenestra-tracker/     Rust: WindowTracker trait + OS 実装 (windows/macos/x11/manual)
                                     placement.rs / surface.rs (純関数・OS に触れない)
  crates/fenestra-overlay/     Rust: Tauri プラグイン
                                     透過ウインドウ、クリック透過、サーフェス管理、ホットキー
  packages/fenestra-ui/        JS: attachInfo、MarkdownPanel、ChartFence、overlayBridge
  apps/fenestra-shell/         参照実装 (プロファイル設定だけで動く単体アプリ)

Voluptas
  overlay-app/                 Fenestra を依存に取り、固有だけを持つ
                                 マーカー投下 (capture-session API)、Volputas 用チャート登録、
                                 overlay-profiles の既定値
```

### 境界の規則 (これを破ると切り離した意味が消える)

1. **Fenestra は Volputas を知らない。** 文字列 `capture-session` も `player-profile-server` も
   Fenestra 側に出てこない。データ取得は「HTTP / ファイル / inline を返す `ContentSource`」
   という抽象までで止める。`/api/local/capture-sessions/...` のような具体は利用側が持つ。
2. **チャート実装は Fenestra に入れない。** Fenestra が持つのは ```chart フェンスの
   **レジストリ** (`registerChart(type, component)`) だけ。`HotspotChart` /
   `NarrativeArcChart` は Volputas のドメイン (`game-insight` / `narrative-arc`) に属したまま、
   利用側が起動時に登録する。`TrendChart` / `RadarChart` も同じ。
3. **ホットキーの意味づけは利用側。** Fenestra は「このキーが押された」を通知するだけで、
   `hype` / `like` / `dislike` / `stress` という語彙は Volputas 側にある。
4. **不変条件は Fenestra が守る。** タップ貫通 (サーフェスは `ignore_cursor_events` を
   解除しない)、モニタへのクランプ、ビュー領域基準の追従は Fenestra 側のテストで固定する。
   利用側から破れる API を出さない。

## 配布方法

LUDIARS は GitHub を release 管理にしか使わないので、npm / crates.io への公開はしない。
既存の `@ludiars/sentiment-core` と同じ **submodule + `file:` 依存**に揃える
(`player-profile-server/lib/lapilli/packages/sentiment-core` の形)。

- JS 側: `overlay-app/lib/fenestra/packages/fenestra-ui` を submodule で置き、`file:` 依存。
- Rust 側: `Cargo.toml` の `path` 依存 (同じ submodule ツリーを指す)。

**注意**: `file:` 依存 + worktree の組み合わせは過去に事故っている
(worktree に submodule の実体が無く `npm ci` が即死する)。切り離し後は
`npm run setup:submodules` を overlay-app にも通し、worktree 作成時の手順に含める必要がある。
これは切り離しが**持ち込む**コストで、切り離さなければ発生しない。

## プロジェクトコード

`Fe` が空いている (`Fa` Famulus / `Fd` Foedus / `Fg` Figmentum / `Fm` Fundamentum は使用中)。
**命名とコードの確定は neco の判断**。正本は `LUDIARS/PROJECT-CODES.md`。

## 切り離しでやることの実体

1. 新リポ作成 (`command-runner.mjs proj:create`) + Excubitor catalog fragment
   (常駐サービスではないので port は取らない)
2. `overlay-app/src-tauri/src/overlay/` と `content/` を `crates/` へ移し、Tauri プラグイン化
   (`tauri::Builder::plugin(fenestra::init())` で他アプリが載せられる形)
3. `overlay-app/src/{panels,markdown,lib}` のうち汎用分を `packages/fenestra-ui` へ移し、
   チャートをレジストリ経由に変える
4. Volputas 側を submodule + アダプタに書き換え、既存テストが緑のままであることを確認
5. Anatomia ドメインの再宣言 (Fenestra 側に新規、Volputas 側は `window-overlay-extension` を
   アダプタだけの membership に縮める)
6. 参照実装 `apps/fenestra-shell` (Volputas 無しで動くことの証明。これが無いと境界 1 が腐る)

## 実施時期

**#793 のマージと実機確認が済むまで着手しない。**

理由: いま切り離すと、実機で追従・クリック透過が動かなかったときに「実装の問題か、切り離しで
壊したのか」の切り分けが二重になる。動くことが一度も確認できていないものを分割するのは、
デバッグ費用を先払いで増やすだけになる。

着手条件:
- #793 がマージ済み
- Windows でゲームウインドウへの追従・クリック透過・ホットキーが実機で確認済み
- 2 つ目の利用先が実在する (仮定ではなく、実際に使う予定のあるアプリ)

3 つ目が重要で、利用先が Volputas 1 つのままなら切り離しは純粋な負債になる
(submodule 運用コストを払って、得るものが無い)。
