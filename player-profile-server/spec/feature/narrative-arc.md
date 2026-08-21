# ナラティブアーク (同一プレイヤー × 同一ゲームの複数セッション集約)

> Spec ID: `SPEC-NARRATIVE-ARC`
>
> 状態: 実装 (2026-08-16)。neco 指示「何度かゲームプレイデータを収集してナラティブアークを作成・解析する。
> 解析は 1 つのゲーム・同じプレイヤーで行うこと」の設計。
> 関連: `emotion-capture-companion.md` (キャプチャ由来の感情曲線)、`emotion-curve-video-tool.md`
> (1 セッションの LLM 評価)、`persona-engine-v2-design.md`。

## 目的

1 回のプレイの感情曲線は「そのセッションの起伏」でしかない。同じプレイヤーが同じゲームを何度か
プレイして残した感情曲線を重ねると、**そのプレイヤーにとってのゲームのナラティブアーク**
(体験構造の再現性、慣れや熟達による変化、記憶に残る山と終わり方) が見えてくる。これを

1. **決定的に集計** (再現可能・LLM 不要) し、
2. その集計を材料に **LLM が言語化** する (任意・派生物)

の 2 段で提供する。

## 前提 (neco 指示)

- **同一ゲーム** — `gameTitle` の完全一致 (前後空白は無視)。表記ゆれの吸収はしない (別ゲーム扱いを
  黙って混ぜるより、ユーザがタイトルを揃える方が安全)。
- **同一プレイヤー** — ローカルモードのデータリポジトリは本人 1 名分だが、明示的に
  `respondent.name === 設定の name` で絞る。取り込んだ他人の記録は集計に入れない。
- 2 セッション未満は `NARRATIVE_ARC_INSUFFICIENT_SESSIONS` (409)。1 本ではアークではない。

## 正規化 (`src/services/narrativeArc/arcSeries.js`)

感情曲線レコード 1 本 → 進行 0..1 軸のポイント列 → ビン系列。

- 位置: `memory` モードは `position/100`。`video` / `capture` は `timeSeconds / セッション長`
  (セッション長 = `sessionPlaytimeMinutes×60`、ただしエントリがそれを超えるなら最終エントリ時刻。
  申告が無ければ最終エントリ時刻)。
- 各ポイントは `valence (-2..2)` / `arousal (1..5)` / `stamp` / `comment`。
- ビン化: 既定 20 ビン、ビン中心でガウス核 (帯域 0.08) 加重平均。核の合計重みが 0.05 未満の
  ビンは `null` (証拠が無い区間を外挿しない)。
- セッション要約: 記録数・平均感情価/強さ・ピーク位置・スタンプ内訳。

## 集約 (`src/services/narrativeArc/arcAggregate.js`)

- ビンごとの平均・標準偏差・カバレッジ (値を持つセッション数)。
- **形状分類** — Reagan らの 6 基本アーク (右肩上がり / 右肩下がり / 落ちて戻る / 上がって落ちる /
  上がって落ちて上がる / 落ちて上がって落ちる) をテンプレート関数にし、平均感情価系列との
  Pearson 相関で最良を採る。値のあるビンが 4 未満なら「判定不能」、平坦なら「平坦」。候補は相関順で全部返す。
- **ピーク / 谷 / 終端** — 平均系列の最大・最小 (位置と値)、終端 = 末尾 3 ビンの平均、
  ピーク・エンド指標 = (ピーク + 終端)/2 (Kahneman のピーク・エンド則の 1 数値化)。
- **一貫性** — セッション間の感情価系列の平均ペア相関。
- **回を重ねた傾向** — セッションを `createdAt` 順に並べ、平均感情価の最小二乗傾き (/回)。
- 出力にはセッションごとの系列と要約・申告アーク (`narrativeArc` 自由記述) を同梱する。

## 永続化 (`narrativeArcService.js`)

- 派生レコードはデータリポジトリの `narrative-arcs/<name>/arc-<sha256(name+title) 先頭24hex>.json`。
  1 (プレイヤー, ゲーム) につき 1 件で、再集計は上書き。
- provenance: `{ extractor: "arc-aggregate/v1", analyzedAt }`、`sourceRecordIds` (元の感情曲線 ID)、
  集計とプロンプトが読む入力だけから作る `sourceRevision` (SHA-256)。
- `evaluation` (LLM 解説) は再集計後も保持し、`evaluation.sourceRecordIds` / `sourceRevision` と現在値の
  不一致で「再集計前の解説」と分かる。同じ ID の感情曲線が人手編集された場合も revision で検出する。
- 解説生成時にも元レコードの現在 revision を照合し、未再集計の変更があれば
  `NARRATIVE_ARC_STALE` (409) で再集計を要求する。古い集計と新しいメモを混ぜた解説は作らない。
- evidence media レジストリ・Cernere カラムには載せない (ローカル専用の派生物)。

## LLM 解説 (`narrativeArcPrompt.js`)

- 既存の感情曲線評価と同じ LLM クライアント (`createLlmTextClient`、既定 claude-cli、未設定は
  `LLM_NOT_CONFIGURED` 503 で fail-fast)。
- プロンプトは純関数で組み立て (テスト対象)。集計値 (形状・相関・ピーク/谷/終端・一貫性・傾き・
  ビン系列) とセッション別要約、元記録のメモ/スタンプ原文を渡し、**数値の再計算はしない**よう指示。
- 出力構成: アーク要約 / ピーク・谷・終端 / セッション間の変化 / 申告アークとの照合 / 開発者への示唆 /
  二流派の判定 (西洋の判定 (機序) / 東洋の判定 (全体観) / 合議、`emotion-judgment-lenses.md`)。
- 保存: `evaluation { schemaVersion: 2, extractor: "llm", model, text, judgments, evaluatedAt, sourceRecordIds,
  sourceRevision }`。`judgments` は `text` を固定見出しで切り出した二流派の判定。
- UI に「集計結果と対象セッションのスタンプ・メモを LLM (Claude) に送信する」旨を常時表示。

## API (local app、127.0.0.1)

| Method | Path | 動作 |
|---|---|---|
| GET | `/api/local/narrative-arcs/games` | 本人の感情曲線があるゲーム一覧 (セッション数付き) |
| GET | `/api/local/narrative-arcs/status` | LLM 解説の設定状態 |
| GET | `/api/local/narrative-arcs` | 集計済みアーク一覧 |
| POST | `/api/local/narrative-arcs/analyze` | `{ gameTitle }` → 集計して保存 (201) |
| GET | `/api/local/narrative-arcs/:id` | 1 件取得 |
| POST | `/api/local/narrative-arcs/:id/evaluate` | LLM 解説を生成して保存 |

## UI (`NarrativeArcPage`, ナビ「自分を知る > ナラティブアーク」)

- ゲーム選択 (セッション数表示、2 未満は集計ボタン無効) → 「アークを集計」。
- `NarrativeArcChart`: 平均アーク (±1σ 帯) + 各セッションの細線 + ピーク/谷マーカー。
- 統計カード (形状・ピーク・谷・終端/ピーク・エンド・一貫性・傾向) と次点候補、セッション表
  (種別・記録数・平均感情価・ピーク位置・スタンプ内訳・申告アーク)。
- 「AI でこのアークを解説」→ 解説表示 (再集計前なら明示)。

## テスト

- `arcSeries.test.js` — セッション長の決定、モード別の位置付け、核平滑化とnullビン、要約。
- `arcAggregate.test.js` — 6 テンプレートの自己回復、平坦/不足の扱い、平均・偏差・極値・終端・
  傾き・一貫性、2 本未満/ビン数不一致の拒否。
- `narrativeArcService.test.js` — ID の安定性、他人・他ゲームの除外、上書き、解説の保持、プロンプト決定性。
- `narrativeArcRoutes.test.js` — API 経路 (409 → 作成 → 集計 → 解説 → 永続ファイル)。

## 非目標

- ゲームタイトルの表記ゆれ吸収・カタログ ID 連携 (GLAB 側の `gameId` は将来の入力候補)。
- 複数プレイヤーの横断比較・母集団アーク (persona-engine の population report の領域)。
- ペルソナ evidence への還流 (アークは表示用の派生物。持ち込むなら別 spec)。
- online (認証) モードへの展開。
