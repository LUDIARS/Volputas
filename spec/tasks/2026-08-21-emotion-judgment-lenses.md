---
task: emotion-judgment-lenses
project: Voluptas
kind: 実装
created: 2026-08-21
spec_links:
  - player-profile-server/spec/feature/emotion-judgment-lenses.md
  - player-profile-server/spec/feature/game-insight.md
  - player-profile-server/spec/feature/narrative-arc.md
  - player-profile-server/spec/feature/emotion-curve-video-tool.md
---
# Volputas 感情分析 LLM に東洋/西洋の二流派判定を取らせる (neco 指示 2026-08-21)

## 指示 (原文)
AIノート「面白さの東洋医学と西洋医学」を加味した上で、AI の感情分析の手法に東洋的と西洋的の判断を取るようにする。

## 対応表
| 指示 | 実装 | 場所 |
|---|---|---|
| 二流派の定義と指示 | `LENSES` (立場・方法・弱み) と `buildDualLensInstructions({ subject })` | `src/services/emotionJudgment/judgmentLenses.js` |
| 構造化 | `parseJudgmentSections(text)` — 固定見出しで西洋/東洋/合議を切り出し、確度と一致度を読む | `src/services/emotionJudgment/judgmentSections.js` |
| 3 系統への配線 | 改善提案 / ナラティブアーク解説 / 感情曲線評価のプロンプト末尾に指示ブロック、保存に `judgments` (schemaVersion 2) | `gameInsight/improvementPrompt.js` + `gameInsightService.js`、`narrativeArc/narrativeArcPrompt.js` + `narrativeArcService.js`、`emotionCurveEvaluationPrompt.js` + `emotionCurveEvaluationService.js` |
| 並列表示 | `JudgmentLensPanel` (西洋/東洋を左右、合議と一致度を下) を 3 画面の本文直下に | `frontend/src/components/JudgmentLensPanel.jsx`、`GameInsightPage` / `NarrativeArcPage` / `EmotionCurveRecordCard` |
| ドメイン | `emotion-judgment-lenses` を新設 (横断境界) | `spec/domains/emotion-judgment-lenses.domain.json` |

## 設計判断
- LLM は 1 回だけ呼ぶ。二流派は別呼び出しではなく、同じ出力に固定見出しで両方書かせる。コストと stale 判定を増やさない。
- 見出しを固定して決定的に切り出す。`judgments` は `text` の派生物で、欠落は `null` のまま保存 (推測で埋めない)。
- 合議の一致度は 高/中/低 の 3 値。数値スコアにすると西洋側へ偏るので入れない。
- 既存 v1 記録は `judgments` を持たず UI はパネルを出さない。再評価で付く。

## 受け入れ条件
- `npm test` (emotionJudgment 1 本 + 既存の gameInsight / narrativeArc / emotionCurveEvaluation テスト更新分) が通る
- Anatomia: `emotion-judgment-lenses` ドメインが新規ファイルを覆う

## 残作業 (この PR の外)
- 実機で 3 系統を再評価し、LLM が固定見出しを守るか (complete 率) を見る。守らない場合は指示文の強化で対応。
