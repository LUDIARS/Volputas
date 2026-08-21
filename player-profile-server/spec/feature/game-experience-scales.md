# 体験尺度 (ゲーム感想の GEQ / PENS 化と、横断集計の順序化)

> Spec ID: `SPEC-GAME-EXPERIENCE-SCALES`
>
> 状態: 実装 (2026-08-21)。neco 指示「ゲーム感想を GEQ と PENS をベースに整備する / トータル分析は順序化して
> 最初から見ていく」の設計。AIノート「感情分析の道具箱」(GEQ / PENS、Yannakakis らの順序性) の実装。
> 関連: `game-insight.md` (横断集計の置き場)、`persona-engine-v2-design.md` (寄与モデル)、`glab-reviews.md`。

## 目的

感想 (`voices`) は「感情価 −2..2 + スキ/嫌い + 自由記述」だけだった。これだと (1) 何が良かったのかが尺度として
残らず、(2) 人によって数字の使い方が違う (いつも 2 の人といつも 0 の人) ので、そのまま平均すると声の大きい
記録者に統計が引きずられる。

1 は学術標準の尺度を器として借りる。2 は「生値を平均する前に、人ごとに順位化・z 化してから集計する」
(順序化) を、横断集計の入口から順に入れる。

## 尺度 (`src/services/gameExperienceScales/scaleDefinitions.js`)

| 尺度 | 構成 | 範囲 | 出典 |
|---|---|---|---|
| GEQ in-game | 7 成分 × 2 項目 = 14 項目 (有能感 / 没入 / フロー / 緊張・苛立ち / 挑戦 / ネガティブ感情 / ポジティブ感情) | 0..4 | IJsselsteijn, de Kort & Poels 2013 |
| PENS | 5 下位尺度 × 1 項目 (有能感 / 自律性 / 関係性 / 臨場感・没入 / 直感的な操作) | 1..7 | Ryan, Rigby & Przybylski 2006 |

PENS の公開項目は権利物なので、**項目文は Volputas 独自の 1 項目パラフレーズ**。下位尺度名と 1..7 の範囲だけを
原典に揃え、下位尺度レベルで比較可能にする。GEQ は in-game 短縮版の成分構成に日本語項目を当てている。
定義はこの 1 ファイルが正本で、UI 側 `frontend/src/lib/experienceScales.js` は id・範囲・項目順を写す (同期必須)。

## 入力 (`scaleScores.js` `validateScales`)

`voices` の任意フィールド `scales: { geq: { <itemId>: 0..4 }, pens: { <itemId>: 1..7 } }`。

- 項目ごと任意。未回答・空文字・null は落とす。回答が 1 つも無い family は落とし、全部無ければ `scales: null`。
- 未知の family / itemId、範囲外、非整数は `INVALID_PROFILE_INPUT` (入力境界なので黙って捨てない)。
- `validateVoiceInput` が呼ぶので local / online / GLAB の全経路で同じ検証になる。

UI: `ExperienceScalesInput` (折りたたみ、既定は閉。回答数を見出しに表示、同じ段をもう一度押すと解除)。
記録カードは `ScaleSummary` で下位尺度の平均をチップ表示。

## 採点 (`scaleScores.js` `scoreScales` / `unitScore`)

下位尺度 = 回答済み項目の平均 (`{ score, answered, of }`)。未回答の下位尺度は出さない。
`unitScore(family, score)` で family の範囲を 0..1 に写す (ペルソナ寄与用)。

## ペルソナ寄与 (`scaleContributions.js`)

下位尺度 → 軸の表 `SCALE_AXIS_MAP` を 1 箇所に置き、v1 (`personaEvidenceAnalysis.js` の 8 軸) と
v2 (`personaEvidence/sourceContributions.js` の style/mtg 軸) の両方がここから引く。

| 下位尺度 | v1 | v2 |
|---|---|---|
| geq/pens 有能感 | mastery | style.mastery |
| geq 没入 / pens 臨場感 | narrative, emotionalEngagement | style.narrative |
| geq フロー | emotionalEngagement | mtg.timmy |
| geq 挑戦 | challenge | style.competitor, style.mastery |
| geq 緊張・苛立ち | — | style.onboarding_need |
| geq ネガティブ感情 (反転) | — | style.routine_tolerance |
| geq ポジティブ感情 | emotionalEngagement | mtg.timmy, style.relaxation |
| pens 自律性 | exploration | style.autonomy |
| pens 関係性 | social | style.socializer |
| pens 直感的な操作 (反転) | — | style.onboarding_need |

「反転」は回答が高いほど特性が *無い* もの (操作が直感的 → オンボーディング要求は低い)。

## 順序化 (`src/services/ordinal/withinPlayer.js`)

Yannakakis, Cowie & Busso「The Ordinal Nature of Emotions」(2017): 自己申告は絶対値より順序が信頼できる。
共通モジュールは純関数 3 つ。

- `baseline(values)` — そのプレイヤー自身の平均 / 標準偏差 / 件数 (null は無視)。
- `zScore(value, baseline)` — 普段との差。sd 0 (いつも同じ値の人) や 1 件だけは **0** (「普段通り」であって不明ではない)。
- `percentileRank(value, population)` — 自分の記録の中での順位 0..1 (同値は中位、1 件だけは 0.5)。
- `normalizeWithinPlayer(values, pool)` — 系列をその人の pool (全セッション / 全ゲーム) で z と順位に写す。

null は null のまま通し、coverage が後段で見えるようにする。

## 横断集計 — 入口から順に順序化する

### 1. 感想の尺度 (`gameInsight/scaleAggregate.js`)

`aggregateScales(allVoices, gameTitle)`: プレイヤーごとに **全ゲームの感想** を baseline にして、対象ゲームの
下位尺度スコアを z / 順位へ写す → プレイヤー内平均 (1 人 1 票) → プレイヤー間平均。生の平均も並べて残す。
出力 `{ extractor: "scale-aggregate-ordinal/v1", playerCount, recordCount, families: { geq: { label, range,
subscales: { flow: { label, raw, z, rank, playerCount } } } } }`。誰も尺度で答えていなければ null。

`GameInsightService.analyze` が `voiceCohortReader` (CohortReader の `voices` コレクション) で全員分を読み、
`analysis.scales` に置く。reader 未設定なら null。

### 2. 感情曲線のビン (`gameInsight/hotspotAggregate.js`)

- `perPlayerBins`: 生のビン平均に加え、そのプレイヤーの全セッション・全ビンを pool にした `valenceZ` / `arousalZ`
  と `baseline` を持つ。
- `aggregateBins`: ビンごとに `valenceZ` / `arousalZ` (プレイヤー間平均) と `agreementOrdinal` (z の散らばり) を足す。
- `detectHotspots`: スパイク探索は **`arousalZ` 系列** で行う (`detectionBasis: "ordinal"`)。ordinal が全 null の
  古い形、および z が一様 (全員平坦) でスパイク情報を持たない場合は生値に戻る (`"raw"`)。
  pain 判定は「生の感情価 < 0」**または**「`valenceZ` ≤ −1 (普段より明らかに下)」。
  スタンプ多数決の pain はそのまま。
- provenance は `hotspot-aggregate-ordinal/v2`。

### 3. 改善提案プロンプト (`improvementPrompt.js`)

ヘッダに「プレイヤー内 z」の感情価・強さ系列と、`formatScales` の GEQ / PENS ブロック (生平均 + z + 人数) を足す。
LLM は数値を再計算しない。

## UI

- `GameInsightPage`: ホットスポット表に「各自の普段との差 (z)」「一致度 (生 / 順序)」列、検出基準の注記。
  `ScaleAggregateTable` で GEQ / PENS 横断表 (生 / z / 順位 / 人数)。回答が無ければ案内文。

## テスト

- `gameExperienceScales/scaleScores.test.js`: 定義の形、検証 (既知キー・範囲・空 family)、採点、unit 化。
- `ordinal/withinPlayer.test.js`: baseline / z / 順位、声の大きさが違う 2 人が同じ順序に乗ること、pool 指定。
- `gameInsight/scaleAggregate.test.js`: 自分の他ゲームを基準にした z、未回答者の除外、決定性。
- `gameInsight/hotspotAggregate.test.js` 追加: 静かな人の自分なりのピークが同等に効く、生値が正でも普段より
  明らかに下なら pain。
- `improvementPrompt.test.js` 追加: z 系列と尺度ブロック。

## 非目標

- 尺度の因子構造 (信頼性係数など) の検証はしない。器を借りるだけ。
- ペルソナ (同一人物内) の集計は順序化しない。順序化は **人をまたぐ** 平均の前にだけ入れる。
- 順列検定・変化点検出 (PELT) は次段。ここでは順序化まで。
