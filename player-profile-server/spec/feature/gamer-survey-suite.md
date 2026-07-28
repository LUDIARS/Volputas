---
type: feature
title: "Gamer survey suite"
description: "Voluptas固有のアンケートを主タイプ/サブタイプ/感情記述の3本に分割し、未測定だった20サブタイプと20次元affectを実測する。"
service: voluptas
domain: survey
tags:
  - survey
  - analysis
  - subtype
  - affect
status: implemented
related:
  - ./local-okf-survey.md
  - ./corpus-survey-integration.md
  - ../data/data-schema.md
updated: 2026-07-27
---

# Gamer survey suite

## User story

回答者として、主タイプ診断だけを短時間で終えたい。より詳しく知りたくなったときに、
サブタイプ判定や自由記述を追加で回答したい。

分析の利用者として、表示されるサブタイプが実際の回答に基づくのか、
未測定の推定値なのかを区別したい。

## 構成

Voluptas固有アンケートは1本にまとめず、測るものごとに分割する
(正本: `src/surveys/surveyCatalog.js`)。

| SURVEY_ID | 設問数 | 測るもの | 受け側 |
|---|---|---|---|
| `gamer-preferences` | 28 | 12次元 (Gamer/Mechanics/Story) + 15軸 style | `services/analysisEngine.js` / `services/preferenceAxes.js` |
| `gamer-subtypes` | 20 | 20 gamer subtypes (5主タイプ×4) | `services/subtypeScoring.js` |
| `gamer-emotions` | 5 | 20次元 affect ベクトル | `services/affectProfile.js` |

分割理由は回答完了率である。3本を単一アンケートに統合すると80問近くなり、
主タイプだけを知りたい回答者に20問のサブタイプ設問を強制することになる。
`gamer-preferences` は設問を増やさず28問のまま据え置き、
既収集の回答と比較可能な状態を保つ。

## 設問のタグ付け

採点対象の設問は共通の4件法 (`src/surveys/agreementScale.js`) を使い、
自身が何を測るかだけをタグで宣言する。

- `dimension` — 12次元エンジン向け (`SURVEY_DIMENSION_MAP` 経由で `DIMENSIONS` へ写像)
- `axis` — 15軸エンジン向け (Discutere と共有する語彙)
- `subtype` — `<主タイプ>.<サブタイプ>` 形式の20キー
- `weight` — freetext 設問が affect ベクトルへ寄与する重み

## サブタイプ判定

`gamer-subtypes` の回答がある場合、`detectSubtypes` は実測値から主タイプ内の
サブタイプを選び `source: 'survey'` を返す。回答が無い場合のみ既存の
位置ベースのヒューリスティックへ落ち、`source: 'heuristic'` を返す。

ヒューリスティックは mechanics/story のスコアを添字の剰余で流用するだけで、
サブタイプ設問を一切参照しない。同じ形の結果として区別なく扱われることを防ぐため、
`source` を必須の出力項目とする。

未採点・未知の回答値は中間値 0.5 を補わずスコアへ寄与させない。
捏造した中間値は「どちらでもない」という実際の回答と区別できなくなる。

## affect ベクトルの重み

`affectProfile.js` は freetext 回答のみを20次元へ写す。
`favorite-titles` は固有名詞の列挙で感情語をほとんど含まないため `weight: 0.5` とし、
体験を語らせる `gamer-emotions` の設問 (`weight: 2`〜`3`) より寄与を下げる。

## GLAB/Corpus への公開

3本とも `visible_to_glab = false` で固定する。

Voluptas固有形式 (`options: [{value,label}]` + `dimension`/`axis`/`subtype`/`scoring`) は
Corpus contract (`src/corpus/surveyContract.js`) の `.strict()` schema および
`options: {choices:[…]}` と非互換であり、フラグを立てるとカタログが
`INVALID_SURVEY_DEFINITION` (500) を返す。両形式の整合は別課題とする。

## 投入

```powershell
npm run seed:surveys
```

`surveys.title` 一致で upsert する。`surveys.id` はDB生成であり、
既存 `survey_responses` の参照先を保つため既存行は更新して作り直さない。

## 未対応 (別課題)

- 1形質あたり複数項目化と逆転項目の導入 (現状はどの形質も1問、黙認バイアス未制御)
- Caillois の paidia↔ludus 軸 (15軸へ追加するとDiscutereとの語彙契約に影響する)
- 複数選択・ランク付け設問型
- 属性設問 (プレイ時間・ゲーム歴・課金額帯) — 個人データ規約の確認が必要
