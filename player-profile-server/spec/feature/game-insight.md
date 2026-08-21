# ゲーム洞察 (複数プレイヤーのホットスポット / 脱落点 + Anatomia × 動画の改善提案)

> Spec ID: `SPEC-GAME-INSIGHT`
>
> 状態: 実装 (2026-08-20)。neco 指示「Volputas で感情分析点を置いたあと、Anatomia と動画でゲームを解析して
> 改善ポイントを提案できるようにする」「プレイヤーごとの感情分析を合わせてホットスポットや脱落点を
> 統計的に出せるようにする」の設計。
> 関連: `narrative-arc.md` (同一プレイヤー × 同一ゲームの集約。本 spec はその**プレイヤー横断**版)、
> `emotion-capture-companion.md` (キャプチャ由来の感情曲線・ゲームマーカー・画面録画)、
> `emotion-curve-video-tool.md` (1 セッションの LLM 評価)。

## 目的

ナラティブアークは「1 人のプレイヤーにとってのゲーム」を見る。本機能は **同じゲームを遊んだ複数プレイヤーの
感情分析点を合わせ**、ゲーム側の問題箇所を見る。

1. **ホットスポット** — 多くのプレイヤーが同じ進行位置で盛り上がる (hype) / つまずく (pain) 箇所を、
   プレイヤー数で重み付けして決定的に抽出する。
2. **脱落点** — セッションがどの進行位置で終わっているか (生存曲線) と、終了直前の感情 (exit mood) から、
   プレイヤーが離れやすい箇所を統計的に出す。
3. **改善提案** — ホットスポット / 脱落点を焦点に、(a) キャプチャセッションのゲームマーカー (ゲーム側が送った
   `event` / 章区切り) で「ゲームの何が起きていたか」、(b) **Anatomia** で「それを実装しているコードはどこか」、
   (c) **画面録画のフレーム** で「画面で何が見えていたか」を集めて LLM に渡し、開発者向けの改善ポイントを書かせる。

集計 (1)(2) は LLM 不要で再現可能。(3) は派生物 (provenance 付き) で、集計が変われば stale と分かる。

## 入力 (`src/services/gameInsight/cohortReader.js`)

- データリポジトリの `emotion-curves/<誰か>/*.json` を**全員分**読む。プレイヤー鍵は `respondent.name`
  (無ければディレクトリ名)。ナラティブアークが除外していた「取り込んだ他人の記録」を、ここでは主役にする。
- 取り込み JSON は object に限り、通常入力と同じ上限 (ゲーム名 200 文字、エントリ 500 件、時刻 864000 秒、
  感情価 -2..2、強さ 1..5) を集計境界でも守る。未知スタンプは集計キーに採用しない。
- 同一ゲーム = `gameTitle` の完全一致 (前後空白無視)。表記ゆれは吸収しない (narrative-arc と同じ理由)。
- 2 セッション未満は `GAME_INSIGHT_INSUFFICIENT_SESSIONS` (409)。プレイヤーが 1 人しかいない場合は集計するが
  `singlePlayer: true` を立て、UI で「横断統計ではない」と明示する。

## 進行軸と正規化 (`hotspotSeries.js`)

- **基準長** = 時刻軸 (video / capture) のセッションのうち最長の `sessionDurationSeconds` (narrative-arc の
  `arcSeries.sessionDurationSeconds` を再利用)。各セッションのエントリは `timeSeconds / 基準長` で 0..1 に置く。
  ナラティブアークが「各セッションを 0..1 に引き伸ばす」のに対し、ここは**絶対時間を共通軸にする**。
  短いセッションは途中で終わる = 脱落点の証拠になる。
- `memory` モードは `position/100` をそのまま進行とみなし、**脱落統計には入れない** (終了位置の証拠を持たない)。
  ホットスポットには入れる。
- セッションごとに `endPosition` (時刻軸のみ)、ビン系列 (既定 20 ビン、`arcSeries.resampleSeries` のガウス核)、
  スタンプ付きエントリのビン割当 (最近傍ビン) を持つ。

## 集約 (`hotspotAggregate.js`)

**プレイヤー 1 人 = 1 票**。多弁なプレイヤーに引きずられないよう、まずプレイヤー内でセッションのビン値を平均し、
その後プレイヤー間で平均する。

- ビンごと: 感情価の平均・標準偏差、強さ (arousal) の平均、`playerCoverage` (値を持つプレイヤー数)、
  `agreement` = 1 − 感情価 sd / 2 (0..1、プレイヤー間の一致度)、スタンプ別の**プレイヤー数** (同一プレイヤーの連打は 1)。
- **ホットスポット**: 強さ系列の z スコア ≥ 1 かつ局所最大、`playerCoverage` ≥ 2 (単一プレイヤー時は 1) のビン。
  感情価 ≥ 0 なら `hype`、< 0 なら `pain`。加えて、`stress`/`dislike` を打ったプレイヤー数が
  `playerCoverage` の過半のビンも `pain` として採る。`score` = 強さ平均 × (coverage / プレイヤー数)。
  各スポットには位置・種別・score・プレイヤー数・スタンプ内訳・代表コメント (最大 5 件、プレイヤー匿名番号付き)。
- **脱落点** (`dropoutAnalysis.js`): 時刻軸セッションの `endPosition` から生存曲線 `survival[bin]` =
  その位置までまだ続いているセッションの割合。終了が集中したビン (終了数の多い順、最大 5) を `dropouts` とし、
  各ビンの `sessionCount`、`playerCount`、`exitValence` (終了前 2 ビンの平均感情価) を付ける。
  終了が基準長の末尾ビン (= 最長セッションのゴール) なのは脱落ではなく `completion` として別扱い。
- 出力は `analysis { referenceLengthSeconds, binCount, playerCount, sessionCount, singlePlayer, bins[], hotspots[],
  dropouts[], completion, survival[], players[] (匿名番号 ↔ セッション数・種別) }`。

## 永続化 (`gameInsightService.js`)

- 派生レコードは `game-insights/<本人 name>/gi-<sha256(title) 先頭 24hex>.json`。1 ゲーム 1 件、再集計は上書き。
- provenance `{ extractor: "hotspot-aggregate/v1", analyzedAt }`、`sourceRecordIds`、`sourceRevision`
  (集計が読む入力だけの SHA-256。narrative-arc と同じ流儀で人手編集を検知)。
- `proposal` (LLM 改善提案) は再集計後も保持し、`proposal.sourceRevision` との不一致で stale 表示。
  提案生成時に revision が違えば `GAME_INSIGHT_STALE` (409)。
- evidence media レジストリ・Cernere カラムには載せない (ローカル専用の派生物)。

## 改善提案 (`improvementContext.js` / `anatomiaClient.js` / `frameExtractor.js` / `improvementPrompt.js`)

`POST /api/local/game-insights/:id/propose` body `{ anatomiaProject?, captureSessionId? }`。

1. **焦点** = ホットスポット (score 順) + 脱落点 (終了数順) を合わせて最大 8 点。
2. **ゲーム文脈** — `captureSessionId` (省略時は元レコードの `captureSessionId` のうち画面録画を持つ最長のもの) の
   セッションについて、焦点位置 × 基準長 = `sessionMs` とし、その時点以前で最も近い `origin: "game"` マーカー
   (`event` / `note` とラベル) と、anchors から線形補間した `gameClockMs` を付ける (`improvementContext.js`、純関数)。
3. **Anatomia** — `anatomiaProject` があれば、焦点ごとに `context --project <p> --task "<ゲーム名> <マーカー label>
   <スタンプ語>"` を実行し、`exemplars` (関数名・ファイル・行) と `existingDomains` を採る。ラベル中の識別子らしい
   トークン (`[A-Za-z_][A-Za-z0-9_]{2,}`) は `find --symbol --json` でも引く。CLI は `VOLPUTAS_ANATOMIA_CLI`
   (anatomia.mjs の絶対パス) を `node` で spawn (shell 非経由、引数は検証済み文字列のみ)。未設定で
   `anatomiaProject` を指定したら `ANATOMIA_NOT_CONFIGURED` (503)。project 名は `^[A-Za-z0-9._-]+$`。
4. **動画フレーム** — セッションに `screenRecording` があり ffmpeg が使えるなら、焦点ごとに 1 フレーム
   (`sessionMs − screenRecording.startSessionMs` 秒) を JPEG で一時ディレクトリへ切り出す。LLM へは**ファイルパス**
   で渡す。Claude CLI 経路では専用一時ディレクトリを `cwd` にして各 `frame-NN.jpg` だけを
   `--allowedTools Read(./frame-NN.jpg)` で許可し、Anthropic API 経路では JPEG を base64 image block に変換する。
   どちらも LLM に渡すプロンプトからホスト上の絶対パスを除き、生成後に一時ファイルは必ず削除する。
   ffmpeg 不在・録画無しはフレーム無しで続行 (提案本文に「画面未参照」と明示させる)。
5. **プロンプト** (`improvementPrompt.js`、純関数) — 集計値 (プレイヤー数・ビン系列・生存曲線) と焦点ごとの
   文脈 (感情・スタンプ・コメント・マーカー・コード位置・フレームパス) を渡し、**数値の再計算はしない**よう指示。
   出力構成: 全体所見 / 焦点ごとの改善ポイント (何が起きているか → 根拠 (感情・マーカー・画面) → 関係コード →
   改善案 → 確度) / 優先順位 / 追加計測の提案 / 二流派の判定 (西洋の判定 (機序) / 東洋の判定 (全体観) / 合議、
   `emotion-judgment-lenses.md`)。
6. 保存: `proposal { schemaVersion: 2, extractor: "llm", model, text, judgments, generatedAt, sourceRevision,
   anatomiaProject, captureSessionId, frameCount, codeLocationCount, focusCount }`。`judgments` は `text` を固定見出しで
   切り出した二流派の判定 (`emotion-judgment-lenses.md` §構造化)。生のマーカー・コード位置・一時ファイルパスは
   `proposal` の構造化フィールドには重複保存しない。

LLM クライアントは既存の `createLlmTextClient` (既定 claude-cli)。`generate({ system, prompt, imagePaths })` —
`imagePaths` は Claude CLI では上記の限定 Read、Anthropic API では image block として解釈する。
UI には「集計結果・焦点のコメント・ゲームマーカー・コード位置・画面フレームを LLM (Claude) に送信する」旨を常時表示。

明示指定された `captureSessionId` は対象 insight と同じ `gameTitle` の本人セッションに限る。別ゲームの ID は
`CAPTURE_SESSION_GAME_MISMATCH` (400)、キャプチャ機能自体が無ければ `CAPTURE_SESSION_NOT_CONFIGURED` (503)
とし、その録画・マーカーを LLM に送らない。

## API (local app、127.0.0.1)

| Method | Path | 動作 |
|---|---|---|
| GET | `/api/local/game-insights/games` | 全プレイヤー分の感情曲線があるゲーム一覧 (プレイヤー数・セッション数) |
| GET | `/api/local/game-insights/status` | LLM / Anatomia / ffmpeg の設定状態 |
| GET | `/api/local/game-insights` | 集計済みレポート一覧 |
| POST | `/api/local/game-insights/analyze` | `{ gameTitle }` → 集計して保存 (201) |
| GET | `/api/local/game-insights/:id` | 1 件取得 |
| GET | `/api/local/game-insights/:id/capture-sessions` | 提案に使えるキャプチャセッション候補 (画面録画の有無付き) |
| POST | `/api/local/game-insights/:id/propose` | `{ anatomiaProject?, captureSessionId? }` → 改善提案を生成して保存 |

## UI (`GameInsightPage`, ナビ「自分を知る > ゲーム洞察」)

- ゲーム選択 (プレイヤー数 / セッション数表示) → 「ホットスポットを集計」。
- `HotspotChart`: 平均感情価 (プレイヤー間 ±1σ 帯) + 強さ (薄い棒) + 生存曲線 (破線) + ホットスポット (● hype /
  ● pain) + 脱落点 (▼)。
- ホットスポット表 (位置・種別・score・プレイヤー数・スタンプ・代表コメント)、脱落点表 (位置・終了数・プレイヤー数・
  exit mood)。単一プレイヤー時は注意書き。
- 改善提案フォーム: Anatomia プロジェクト名 (任意)、キャプチャセッション (任意・画面録画有無) → 「AI に改善ポイントを
  提案させる」→ 提案表示 (再集計前なら明示)。

## テスト

- `cohortReader.test.js` — 取り込み JSON の非 object レコード拒否。
- `hotspotSeries.test.js` — 基準長、時刻軸/memory の位置付け、endPosition、スタンプのビン割当。
- `hotspotAggregate.test.js` — プレイヤー 1 票の重み付け、hype/pain の抽出、単一プレイヤー扱い、agreement。
- `dropoutAnalysis.test.js` — 生存曲線、脱落ビンの順位、completion の分離、exit valence。
- `improvementContext.test.js` — 直前ゲームマーカー、anchors 補間、フォーカス選定の上限。
- `anatomiaClient.test.js` — 引数組み立て (shell 非経由)、JSON 解釈、`(no hits)`、未設定エラー。
- `frameExtractor.test.js` — shell 非経由の ffmpeg 起動、ハング時の timeout / kill。
- `improvementPrompt.test.js` — 決定性、フレーム/コード位置の有無で文面が変わる。
- `gameInsightService.test.js` — ID 安定性、全プレイヤー横断の選択、上書き、stale 検知、提案の保持。
- `gameInsightRoutes.test.js` — API 経路 (409 → 作成 → 取得 → 提案 → 永続ファイル)。

## 非目標

- ゲームタイトルの表記ゆれ吸収・カタログ ID 連携。
- 章・ステージ単位での進行軸 (ゲームマーカーが揃ったら将来の軸候補)。現状は絶対時間 / 基準長。
- 動画の機械解釈 (シーン検出・OCR)。フレームは LLM への文脈供給のみ。
- Anatomia 解析の自動登録 (`project add/analyze` は開発者が事前に行う)。
- ペルソナ evidence への還流、online (認証) モードへの展開。
