# Voluptas での使い方

このファイルだけがリポジトリ固有。ほかのファイル（コア）は導入先で共通にする。
コアの正本は当面 LUDIARS/Discutere の `skills/creator-insight/` に置く。コアを変えるときは正本で変え、ここへ同じ内容を反映する。

## Voluptas での位置づけ

- エージェントが読んで実行するスキルであり、サーバの機能ではない。API、画面、migration を足さない。
- 遊び手のプレイタイプは、Voluptas のペルソナ分析（persona v2）が正本。**このスキルで別のスコアを作り直さない。**
  ペルソナ分析の結果があれば、特徴カードの `play.externalAnalysis` に入れ、遊び手の面の第一の根拠にする。
- このスキルが足すのは、作り手の面（ポートフォリオとコード）、性格（行動スタイル）、人生脚本（アンケート）の3つ。

## 使える入力

| 入力 | 取り方 |
|---|---|
| プレイタイプ（遊び手） | 本人のペルソナ分析の結果。15軸の `preferenceAxes`、`aversions`、`mechanicReactions`、`classification` |
| チャットログ | 本人が持ち込んだ Discord / Slack のエクスポート |
| コード | 本人が指定したリポジトリ |
| ポートフォリオ | 本人が渡した URL またはファイル |
| アンケート | `data/life-script-questionnaire.ja.json` への本人の回答 |

Voluptas が持つアンケート回答・感想・感情曲線は、ペルソナ分析を通した結果だけを使う。生のレコードをこのスキルで読み直さない。

## 語彙

- 15軸の正本は `player-profile-server/src/services/preferenceAxisDefinitions.js`。軸を足さない。
- 12次元の分類の正本は `player-profile-server/src/services/hobbyPatternDefinitions.js`。
- メカニクス辞書は Ludus の辞書（`player-profile-server/frontend/src/data/ludus-lexicon.json`）の ID を使う。

## 人生脚本と `story_*` を混ぜない

12次元の分類にある `story_winner` / `story_banal` / `story_loser` は、遊びの中で好む物語の型であり、本人の人生脚本の判定ではない。

- 人生脚本アンケートの結果を `story_*` に写像しない。逆もしない。
- 対話用メモに「勝者」「敗者」のラベルを書かない。
- 人生脚本アンケートを Voluptas のアンケート基盤（`src/localSurvey/`、`src/surveys/`）に載せる場合は、別の作業として設計する。このスキルの導入には含めない。

## 同意と仮名

- ペルソナの研究提供の同意（既定 off）とは別に、このスキルの実行について本人の同意を取る。
- 仮名 ID は既存の pseudoId（`src/services/pseudoId.js`、鍵は `VOLUPTAS_PSEUDO_ID_SECRET`）を使う。新しい鍵を作らない。
- 個人データの正本は Cernere。特徴カードに氏名・メールアドレス・表示名を入れない。

## 書き戻さない

- 特徴カードと対話用メモを、Voluptas の DB、データリポジトリ（VolputasData）、エクスポート（`exports/personas.jsonl`）に書かない。
- 性格と人生脚本の結果を、ペルソナ分析の入力（evidence）に加えない。Discutere へのブリッジにも載せない。
- 作業ファイルはリポジトリの外に置く。

## ツールの置き場所

| 種類 | 場所 |
|---|---|
| 集計ツール（純関数） | `player-profile-server/src/creatorInsight/<名前>.js` |
| テスト | 同じ場所の `<名前>.test.js`（`npm test` が `src/**/*.test.js` を拾う） |
| 実行の入口 | `player-profile-server/scripts/creator-insight.js` |
| 索引 | `player-profile-server/src/creatorInsight/README.md` |

ペルソナ分析の既存の集計（`src/services/personaEvidence/`）と同じ計算を作り直さない。使えるものは呼ぶ。

## 外部への送信

- エクスポートしたログの本文を、外部の API に送らない。
- LLM に渡すのは、特徴カードと、同意のある場合の引用（20件、各120字、仮名化済み）だけ。

## 仕様

受入条件とデータの保持は `spec/feature/creator-insight.md`。
