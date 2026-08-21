---
task: game-experience-scales-ordinal
project: Voluptas
kind: 実装
created: 2026-08-21
spec_links:
  - player-profile-server/spec/feature/game-experience-scales.md
  - player-profile-server/spec/feature/game-insight.md
---
# Volputas ゲーム感想の GEQ / PENS 化 + トータル分析の順序化 (neco 指示 2026-08-21)

## 指示 (原文)
1. ゲーム感想を GEQ と PENS をベースに整備する
2. トータル分析は順序化して最初から見ていく (確認済み: 順序 (ordinal) 化 = 人ごとに順位化 / z 化してから集計)

## 対応表
| 指示 | 実装 | 場所 |
|---|---|---|
| 1 尺度 | GEQ in-game 7 成分 × 2 項目 (0..4) と PENS 5 下位尺度 × 1 項目 (1..7、項目文は独自) の定義 | `src/services/gameExperienceScales/scaleDefinitions.js`、UI 写し `frontend/src/lib/experienceScales.js` |
| 1 入力 / 採点 | `voices.scales` の検証 (`validateVoiceInput` 経由で全経路)、下位尺度平均、0..1 化 | `scaleScores.js`、`profileEvidenceSchemas.js` |
| 1 UI | 折りたたみ入力 `ExperienceScalesInput`、記録チップ `ScaleSummary` | `VoicePage.jsx` |
| 1 ペルソナ | 下位尺度 → 軸表を 1 箇所にして v1 / v2 両方から引く | `scaleContributions.js`、`personaEvidenceAnalysis.js`、`personaEvidence/sourceContributions.js` |
| 2 共通 | プレイヤー内 z / 順位の純関数 | `src/services/ordinal/withinPlayer.js` |
| 2 尺度の横断 | 他ゲームを基準に順序化 → 1 人 1 票 → 平均。`analysis.scales` | `gameInsight/scaleAggregate.js`、`gameInsightService.js` (+ `voices` CohortReader)、`gameInsightComposition.js` |
| 2 感情曲線の横断 | ビンに `valenceZ` / `arousalZ` / `agreementOrdinal`、スパイク検出を順序化系列で、pain に「普段より明らかに下」 | `gameInsight/hotspotAggregate.js` (provenance `hotspot-aggregate-ordinal/v2`) |
| 2 提案 / UI | プロンプトに z 系列と尺度ブロック、洞察画面に z 列と尺度横断表 | `improvementPrompt.js`、`GameInsightPage.jsx`、`ScaleAggregateTable.jsx` |
| ドメイン | `game-experience-scales` 新設 | `spec/domains/game-experience-scales.domain.json` |

## 設計判断
- PENS の公開項目は権利物なので、下位尺度名と範囲だけ原典に揃え、項目文は独自にした (spec に明記)。
- 順序化は「人をまたぐ平均の前」にだけ入れる。同一人物内のペルソナ集計には入れない (個人内の差は生値のままが読みやすい)。
- sd 0 / 1 件の z は 0 (= 普段通り) とし、null にしない。null は coverage の意味にだけ使う。
- ホットスポットの生の感情価・強さは残し、順序化の値を並べる。pain 判定は生 < 0 を残したまま「普段より明らかに下」を OR で足す (既存の検出を狭めない)。
- `scales` を読む CohortReader は `voices` コレクションを指す別インスタンス。感情曲線の reader と同じクラスで、エラー文だけコレクション名入りに一般化。

## 受け入れ条件
- `npm test` (scaleScores / withinPlayer / scaleAggregate の新規 3 本 + hotspotAggregate / improvementPrompt / gameInsight の更新分) が通る
- Anatomia: `game-experience-scales` ドメインが新規ファイルを覆う

## 残作業 (この PR の外)
- 実データで順序化前後のホットスポット差分を見て、`valenceZ ≤ −1` の閾値が妥当か確認
- 順列検定 (ホットスポットの p 値) と PELT は次段
