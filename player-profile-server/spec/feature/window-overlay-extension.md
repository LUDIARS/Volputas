# ウインドウ表示拡張ツール (Tauri v2 オーバーレイ)

> Spec ID: `SPEC-WINDOW-OVERLAY-EXTENSION`
>
> 状態: 設計 (2026-08-21)。neco 指示「Volputas のサポートツール (ウインドウに取り付いて感想を拾うもの)
> を改修して『ウインドウ表示拡張ツール』にする。MAUI 的なマルチプラットフォームで、Markdown と
> グラフが書ける技術スタック」。
> 前身: `emotion-capture-companion.md` (`SPEC-EMOTION-CAPTURE-COMPANION`)。
> 関連: `game-insight.md`、`narrative-arc.md`、`emotion-curve-video-tool.md`。

## 目的

これまでの感情キャプチャ・コンパニオンは「Volputas 本体のウインドウの中」でしかキャプチャ操作が
できず、拾えるのも感情キャプチャ由来の感想 (マーカー・音声・視線) に限られていた。

本仕様はこれを **任意のアプリケーションウインドウに追従して情報を重ねる汎用オーバーレイ**へ
一般化する。感想拾いは、その上に載る表示コンテンツの 1 つになる。

1. **ウインドウ追従** — ユーザが選んだ対象ウインドウの位置・サイズ・可視状態・Z 順に追従し、
   その上 (オーバーレイ) または横 (ドックパネル) に拡張表示を出す。
2. **Markdown 表示** — 任意の Markdown を描画する。ローカルファイルはライブリロードする。
3. **グラフ表示** — Markdown 内のフェンスドブロックとして、また単独パネルとして、時系列・
   ホットスポット・レーダー等のグラフを描画する。
4. **感想拾い (継承)** — ホットキーとオーバーレイ上のボタンでマーカー・コメントを投下し、
   既存の capture-session API に載せる。

## 非目標

- ゲームプロセスへの描画フック (DirectX/OpenGL/Vulkan の inject)。**別ウインドウの重ね描画のみ**扱う。
  アンチチートに触れる経路を持たない。
- Wayland での自動ウインドウ追従 (プロトコル上、他クライアントの位置を取得できない)。
  Wayland では手動配置モードに fallback する (§追従)。
- 対象ウインドウの内容の読み取り・改変。画面キャプチャは既存 capture-session の責務のまま。
- ペルソナ evidence の生成。拾ったマーカーは従来どおり事後の感情曲線記入の参照材料に留める。

## 技術スタック

**Tauri v2** (Rust コア + WebView フロント) を採用する。

| 要件 | 満たし方 |
|---|---|
| マルチプラットフォーム | Windows / macOS / Linux (X11) + Android / iOS を単一コードベースで出す |
| 透過・最前面・クリック透過 | Tauri v2 のウインドウ API (`transparent` / `always_on_top` / `set_ignore_cursor_events`) が標準で持つ |
| Markdown | `react-markdown` + `remark-gfm` (WebView 側) |
| グラフ | 既存 React チャート実装 (`HotspotChart` / `NarrativeArcChart` / `TrendChart` / `RadarChart`) を共有パッケージ化して再利用 |
| 他ウインドウの追従 | Rust 側の OS 別実装 (§追従) |
| 既存資産 | フロントは既存 Volputas と同じ React 19 + Vite。ロジック・スタイルをそのまま持ち込める |

.NET MAUI を採らない理由: デスクトップ Linux 非対応、他ウインドウ追従オーバーレイは
Win32/AppKit interop を全面自作、既存 React 資産が使えない。Electron を続けない理由:
モバイル不可、常駐オーバーレイとしてメモリが重い、他ウインドウ追従に native addon が要る。

## 配置

```
overlay-app/                        新規 (リポジトリルート)
  src-tauri/
    src/
      main.rs                       起動・プラグイン登録
      overlay/
        window_target.rs            対象ウインドウの identity (id / title / process)
        tracker.rs                  追従ループ (OS 実装を trait で切替)
        tracker_windows.rs          Win32 実装
        tracker_macos.rs            AppKit / Accessibility 実装
        tracker_x11.rs              X11 実装
        tracker_manual.rs           Wayland / 未対応環境の手動配置 fallback
        placement.rs                overlay / dock の矩形計算
      hotkey.rs                     グローバルホットキー → マーカー投下
      content/
        markdown_source.rs          ファイル監視 + 読み出し
        api_client.rs               Volputas local API クライアント
    tauri.conf.json
  src/                              WebView フロント (React 19 + Vite)
    panels/MarkdownPanel.jsx
    panels/ChartPanel.jsx
    panels/MarkerPanel.jsx
    markdown/renderChartFence.jsx
    lib/overlayBridge.js            Tauri command / event ラッパ
player-profile-server/
  src/local/overlayRoutes.js        オーバーレイ向けローカル API (追加)
  src/services/overlay/             Markdown ドキュメント / チャートデータの合成
  spec/feature/window-overlay-extension.md
packages/charts/                    共有チャート (本体フロントと overlay-app が import)
```

`overlay-app` と `player-profile-server/frontend` は `packages/charts` を Vite alias で
source のまま取り込む。file: 依存にすると両 lockfile の再生成が要るだけで、得るものが無い。

`overlay-app` は Volputas local app (127.0.0.1) のクライアントであり、プロフィール DB へ
直接は触らない。local app が起動していなくても Markdown / グラフ表示は単独で動く
(感想投下だけが無効化される)。

local app の origin は Excubitor / ProcessMap が `VOLPUTAS_LOCAL_URL` として注入する。
固定ポートへの fallback は持たず、未設定または loopback 以外の origin なら起動時に失敗する。

## ウインドウ追従

### 対象の選択

`overlay:list_windows` コマンドが可視トップレベルウインドウを列挙する
(`{ id, title, processName, rect, isMinimized }`)。ユーザは一覧から選ぶか、
「次にクリックしたウインドウ」ピックモードで選ぶ。選択は `WindowTarget` として
`{ processName, titlePattern }` で永続化し、再起動後に同じアプリへ再バインドする。

### 追従ループ

| OS | 位置取得 | 変化検知 |
|---|---|---|
| Windows | `GetWindowRect` / `GetWindowTextW` / `IsIconic` | `SetWinEventHook` (`EVENT_OBJECT_LOCATIONCHANGE`, `EVENT_SYSTEM_FOREGROUND`, `EVENT_OBJECT_DESTROY`) |
| macOS | Accessibility API (`AXUIElement` の position/size) | 通知 + 100ms ポーリング併用。Accessibility 権限が要る |
| Linux (X11) | `xcb` の `GetGeometry` / `TranslateCoordinates` | `ConfigureNotify` の StructureNotify 購読 |
| Wayland / その他 | 取得不可 | 手動配置モード。ユーザが置いた位置に留まる |

- 追従は **イベント駆動を第一とし、ポーリングは 100ms を上限のバックアップ**とする。
  常時ポーリングでゲームのフレームを削らない。
- 対象が最小化・非表示・破棄されたらオーバーレイを隠す。対象が復帰したら復帰させる。
- 対象がフォアグラウンドでなくなったとき、`followZOrder: true` ならオーバーレイも下げる
  (既定 true。常時最前面にしたい場合だけ false)。
- 対象が閉じられたら `target-lost` イベントを出し、UI は再バインド待ちの状態を出す。
- 初回の対象未選択時と Wayland の手動配置モードでは、設定用ウインドウを操作可能状態で表示する。
  手動配置はヘッダの「移動」操作で行い、自動追従を待って不可視のままにしない。

### 配置モード

- `overlay` — 対象ウインドウ矩形の内側。`anchor` (9 分割) と `margin`、`opacity` を持つ。
- `dock` — 対象ウインドウの外側 (left/right/top/bottom) に吸着。対象を覆わない。
- `detached` — 追従しない自由配置。

クリック透過は既定 ON (`set_ignore_cursor_events(true)`)。ホットキー、またはオーバーレイ端の
グラブハンドルにポインタが乗ったときだけ OFF にして操作を受ける。ゲーム操作を奪わないための
不変条件で、**操作可能状態は視覚的に明示する** (枠のハイライト)。

## 表示コンテンツ

### Markdown

- ソースは `file` (ローカル `.md`、`notify` で監視しライブリロード)、`inline` (設定に直書き)、
  `api` (local app のエンドポイント) の 3 種。
- 描画は `react-markdown` + `remark-gfm`。GFM テーブル・タスクリスト・打ち消しを含む。
- リンクは既定で外部ブラウザに開く。WebView 自体の遷移は許可しない (既存 Electron シェルと同じ境界)。
- 生 HTML は許可しない (`rehype-raw` を入れない)。オーバーレイは他所の文書を映すため、
  スクリプト混入の経路を作らない。

### グラフ

Markdown 内のフェンスドブロックで宣言する。

````markdown
```chart
{ "type": "hotspot", "source": { "kind": "api", "path": "/api/local/overlay/charts/hotspot/<insightId>" } }
```
````

- `type`: `hotspot` | `narrative-arc` | `trend` | `radar` | `series`
- `source`: `inline` (データ直書き) / `api` (local app) / `file` (JSON)
- `api.path` は `/api/local/overlay/` 配下だけを許可し、他の local API や外部 origin は読まない。
- 実装は既存 React チャートコンポーネントを `packages/charts` として切り出し、Volputas 本体
  フロントと overlay-app の双方から import する。**チャートの実装は二重に持たない。**
- `mermaid` フェンスも受け付ける (構成図・フロー用)。
- 未知の `type`・スキーマ不一致は、パネルを壊さずブロック位置にエラーカードを出す。

### 感想拾い (既存機能の継承)

- グローバルホットキー (既定 `Ctrl+Alt+1..4`) で `hype` / `like` / `dislike` / `stress` の
  マーカーを投下する。オーバーレイ上のボタンでも同じ。
- コメントは `Ctrl+Alt+Enter` で入力欄を開く (このときだけクリック透過を解除)。
- 投下先は既存 `POST /api/local/capture-sessions/active/markers` (ルータが `origin: "desktop"` を付ける)。
  アクティブなセッションが無ければ local app は 409 `NO_ACTIVE_SESSION` を返す。
  そのときはオーバーレイ側でローカルにバッファし、セッション開始時に `sessionMs` へ
  載せ替えて FIFO で送る。送信失敗した backlog より新しい投下を先に送らず、
  **投下を取りこぼさない**ことを優先する。
- local app 未起動時はボタン・ホットキーを無効表示にし、無言で捨てない。

## ローカル API (overlayRoutes)

`/api/local/overlay` に 127.0.0.1 バインドのまま追加する (既存の境界は変えない)。
CORS は足さない: WebView からではなく `content/api_client.rs` (Rust 側) が叩くため。

| メソッド | パス | 返すもの |
|---|---|---|
| GET | `/api/local/overlay/status` | 録画中セッション (`id` / `status` / `startedAt`)。ローカル絶対パスは返さない |
| GET | `/api/local/overlay/markdown` | `<dataRepositoryPath>/overlay-docs` 直下の `.md` 一覧 |
| GET | `/api/local/overlay/markdown/:documentId` | その Markdown 本文 (パス区切りを含む id は 400) |
| GET | `/api/local/overlay/charts/:kind/:recordId` | `hotspot` / `narrative-arc` の `analysis` |

## 設定

`overlay-app` の設定は `overlay-profiles/<name>.json` として保存する。1 プロファイル =
「対象ウインドウ + 配置 + パネル構成」。ゲームごとに切り替えて使う。
初回など対象未選択時は `target` の両フィールドを `null` とし、勝手に任意のウインドウへ
結び付けず再バインド待ちを表示する。
プロファイル切替・保存は、ホットキー登録を含む native 状態の反映に失敗したら以前の状態へ戻し、
適用できないプロファイルを永続化しない。

```jsonc
{
  "schemaVersion": 1,
  "name": "KonbiniDominant プレイ中",
  "target": { "processName": "KonbiniDominant.exe", "titlePattern": "^Konbini" },
  "placement": { "mode": "dock", "side": "right", "width": 420, "opacity": 0.92 },
  "followZOrder": true,
  "clickThrough": true,
  "panels": [
    { "type": "markdown", "source": { "kind": "file", "path": "E:/…/checklist.md" } },
    { "type": "chart", "chart": { "type": "hotspot", "source": { "kind": "api", "path": "…" } } },
    { "type": "markers", "hotkeys": { "hype": "Ctrl+Alt+1" } }
  ]
}
```

## 既存ツールとの関係

- Volputas 本体の Electron シェル (`player-profile-server/desktop/`) は**そのまま残す**。
  データ管理・感情曲線編集・ナラティブアークの閲覧はこれまでどおり本体 UI で行う。
- 移すのは「プレイ中に画面の脇で使うもの」だけ: 感想マーカー投下と、プレイ中に見たい参照情報。
- 既存 `CaptureDesktopPanel` の録画・視線・キャリブレーションは本体 UI に残す
  (カメラ・画面キャプチャの権限境界を増やさないため)。

## テスト

- Rust: `placement.rs` の矩形計算 (9 アンカー × 4 ドック辺 × マルチモニタ座標)、
  `tracker` の状態遷移 (可視 → 最小化 → 復帰 → 破棄) を trait のモック実装で。
- フロント: `renderChartFence` の型分岐とスキーマ不一致時のエラーカード、Markdown の
  生 HTML 不許可、マーカーのオフラインバッファ → セッション開始時の載せ替え。
- 実機確認: Windows でゲームウインドウへの追従・クリック透過・ホットキー。
  macOS は Accessibility 権限の許諾フローを含めて確認する。

---

## 追補 (2026-08-21): 情報サーフェス — オーバーレイ表示のラッパー

> neco 指示「オーバーレイ表示を簡単に出来るラッパーを作る (タップイベントは貫通させる)。
> 情報を表示する。この情報ウインドウは元のウインドウ枠をはみ出してよく、元のウインドウに
> 追従する。追従点は元のウインドウのビュー領域。フルスクリーンの時はビューポート外に置いて
> いたハイライトも画面内に入れる」。

§配置モード の `overlay` / `dock` / `detached` は「パネルをどこに置くか」の低レベル表現で、
呼び出し側がモードとアンカーと余白を毎回組み立てることになる。ここでは**情報サーフェス
(info surface)** という 1 段上のラッパーを足す。呼び出しは「対象のビュー領域のこの点に、
この大きさで、この内容を出す」だけで済む。

### 呼び出し

```js
const surface = await attachInfo({
  at: { viewX: 0.5, viewY: 0.2 },        // ビュー領域内の相対座標 (0..1)
  offset: { x: 0, y: -160 },             // そこからのピクセルずらし (枠外に出てよい)
  size: { width: 360, height: 200 },
  align: "bottom-center",                // 上の点にサーフェスのどこを合わせるか
  content: { kind: "markdown", source: { … } },   // または { kind: "chart", chart: { … } }
});
await surface.update({ content: … });
await surface.close();
```

### 不変条件

1. **タップイベントは常に貫通する。** 情報サーフェスは `set_ignore_cursor_events(true)` を
   解除しない。§クリック透過と操作境界 のグラブハンドル・hover 解除は**適用しない** —
   サーフェスは「見せるだけ」の面で、操作を受ける面 (パネル) とは別物として扱う。
   操作が要るものはパネルで出す。この区別を曖昧にすると、ゲーム中に入力を奪う経路が復活する。
2. **基準は対象の外枠ではなくビュー領域。** タイトルバー・境界・メニューバーを除いた
   クライアント領域を基準にする。外枠基準だと OS・テーマ・DPI で数十 px ずれ、
   ゲーム画面内の特定地点を指せない。
3. **対象ウインドウの枠外へはみ出してよい。** サーフェスは独立した透過ウインドウで、
   対象の矩形にクリップしない。
4. **常にモニタ内へ収める。** はみ出しは対象ウインドウに対して許すが、画面外は許さない。
   フルスクリーン時にビュー領域がモニタ全面を占めるため「ビューポート外に置いた
   サーフェスが画面外へ出る」ことになるが、この規則によって自動的に画面内へ引き戻される。
   **フルスクリーンを特別扱いする分岐は書かない** — モニタへのクランプ 1 本で足りる。

### ビュー領域の取得

`WindowInfo` に `viewRect` を足す (外枠 `rect` は残す。ドック配置は外枠基準のままが正しい)。

| OS | ビュー領域 |
|---|---|
| Windows | `GetClientRect` + `ClientToScreen` でスクリーン座標へ変換 |
| macOS | `AXWindow` の content view frame (無ければ外枠から `AXTitleBarHeight` を引く) |
| Linux (X11) | ウインドウの inner geometry (`GetGeometry` の border を除いた領域) |
| 手動配置 | 外枠と同一 (ビュー領域を知る手段が無いため) |

### 配置計算

`overlay/surface.rs` に純関数として置く (OS・ウインドウハンドルに触れない)。

```
resolve_surface_rect(view: Rect, monitor: Rect, spec: &SurfaceSpec) -> Rect
```

1. `view` 内の相対座標 `at` からアンカー点を求める
2. `offset` を足す
3. `align` に従ってサーフェス矩形を置く
4. `monitor` へクランプする (幅・高さがモニタを超える場合はモニタに合わせて縮める)

`view` がモニタを覆っているか (= フルスクリーン相当か) は計算に**現れない**。不変条件 4 の
とおりクランプ 1 本で扱う。

### テスト

- ビュー領域基準のアンカー 4 隅・中心と、`align` 9 通りの組み合わせ
- 対象の枠外へはみ出す `offset` が、対象矩形にクリップされないこと
- はみ出した先がモニタ外になる場合にモニタ内へ引き戻されること (フルスクリーン相当の
  ビュー領域 = モニタ矩形 でも同じ結果になること)
- サーフェスがモニタより大きい場合にモニタへ収まるまで縮むこと
- サーフェスは `ignore_cursor_events` を解除する経路を持たないこと (パネルとの区別)
