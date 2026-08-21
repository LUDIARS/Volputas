# 二流派の判定 (感情分析 LLM に西洋/東洋の判定と合議を取らせる)

> Spec ID: `SPEC-EMOTION-JUDGMENT-LENSES`
>
> 状態: 実装 (2026-08-21)。neco 指示「AI の感情分析の手法に東洋的と西洋的の判断を取るようにする」
> (AIノート「面白さの東洋医学と西洋医学」を加味) の設計。
> 関連: `game-insight.md` (改善提案)、`narrative-arc.md` (LLM 解説)、`emotion-curve-video-tool.md`
> (1 セッションの LLM 評価)。

## 目的

「面白い / つまずく」の読み方には二つの流派がある。

| | 西洋 (機序) | 東洋 (全体観) |
|---|---|---|
| 立場 | 単一の機序で説明する。理論名 + 計測値 | 体験全体を一枚の流れとして読む。理由を一つに絞らない |
| 根拠 | 与えられた集計・スタンプ数・生存曲線・マーカーの数値のみ | 曲線の形・言葉遣い・並び・マーカーとフレームの文脈 |
| 強み | 誰が読んでも同じ結論 (再現性) | 数値に出ない「なんとなく死んでいる」を拾う (視野) |
| 弱み | 測れたものしか見ない | 再現性が読み手に依存する |

片方だけでは弱点がそのまま残る。Volputas の感情分析 LLM はすべて **両方の判定を出し、合議で一致点と
食い違いを分けて**から処方を出す。西洋が見落としたものは「次に測るべきもの」へ、東洋が示せなかった根拠は
「次に観察すべきもの」へ変換させる。

## 対象

| 系統 | プロンプト | 保存先 | subject |
|---|---|---|---|
| ゲーム洞察の改善提案 | `services/gameInsight/improvementPrompt.js` | `proposal.judgments` | このゲームの改善 (焦点全体) |
| ナラティブアーク解説 | `services/narrativeArc/narrativeArcPrompt.js` | `evaluation.judgments` | このプレイヤーのナラティブアーク |
| 感情曲線評価 (1 セッション) | `services/emotionCurveEvaluationPrompt.js` | `evaluation.judgments` | このセッションの体験 |

## 指示 (`src/services/emotionJudgment/judgmentLenses.js`)

`buildDualLensInstructions({ subject })` が返す固定ブロックを、各プロンプトの出力構成の末尾に追加する。
見出しは一字一句固定:

```
## 西洋の判定 (機序)     — 機序 / 根拠 / 処方 / 確度 (高・中・低)
## 東洋の判定 (全体観)   — 読み / 根拠 / 処方 / 確度 (高・中・低)
## 合議                  — 一行目「一致度: 高|中|低」、一致点 → 食い違い → 互いの盲点 → 最終処方
```

最終処方は一致した点から出し、食い違った点は処方にせず保留と書かせる。LENSES 定義 (立場・方法・弱み) は
この 1 ファイルだけが持ち、3 系統のプロンプトは subject を渡すだけ。

## 構造化 (`src/services/emotionJudgment/judgmentSections.js`)

`parseJudgmentSections(text)` が LLM 本文を固定見出しで切り出す。

- 出力: `{ schemaVersion: 1, western: { text, confidence } | null, eastern: { text, confidence } | null,
  synthesis: string | null, agreement: '高'|'中'|'低'|null, complete: boolean }`
- 見出しレベル (`##`/`###`)、全角括弧、太字 (`**…**`) の揺れは許容する。見出しが無い部分は `null`。推測で埋めない。
- `確度:` は各節の本文から、`一致度:` は合議の行頭から読む。規定外の値 (「とても高い」等) は `null`。
- 決定的。同じ本文からは常に同じ結果。LLM の再呼び出しは行わない。

## 保存

`proposal` / `evaluation` の `schemaVersion` を 2 に上げ、`text` と並べて `judgments` を持つ。`text` は従来通り
全文。`judgments` は `text` の派生物 (切り出し) であり、UI が並列表示するためだけに持つ。schemaVersion 1 の
既存記録は `judgments` を持たず、UI はパネルを出さない (再評価で付く)。

## UI (`frontend/src/components/JudgmentLensPanel.jsx`)

`GameInsightPage` (改善提案)、`NarrativeArcPage` (解説)、`EmotionCurveRecordCard` (評価) の本文直下に共通パネル。
西洋 / 東洋を左右に並べ (各確度タグ)、合議を下に置いて一致度を色タグで示す。`complete=false` は
「判定が一部欠けています」タグ、見出しが無い列は「出力に含まれていません」。

## テスト

- `emotionJudgment/judgmentLenses.test.js`: 指示の決定性と見出し順、切り出し (確度・一致度)、見出し揺れの許容、欠落時の null。
- 各系統の既存テストに `judgments` の保存と、プロンプトに「# 二流派の判定」が含まれることを追加。

## 非目標

- 判定ごとに LLM を 2 回呼ぶことはしない (1 回の出力を二つの見出しで書かせる)。
- 合議の「一致度」を数値スコアに変えない。高/中/低の 3 値で十分で、これ以上は西洋側への偏りになる。
