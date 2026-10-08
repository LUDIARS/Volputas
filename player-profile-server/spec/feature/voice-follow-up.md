---
title: ユーザの声の追加ヒアリング
type: feature
service: voluptas
status: implemented
updated: 2026-10-09
---

# ユーザの声の追加ヒアリング

## 目的

感想 (ユーザの声) の最初の投稿は手軽に保ち、分析に足りない情報だけを後から一問ずつ聞く。
プレイヤーの原文は書き換えず、未回答と「中立」を取り違えない。

## 最初の投稿

- 必須: ゲーム名・感想 (原文)・どこまで遊んだか (`playProgress`)。
- `playProgress`: `early` 序盤 / `middle` 中盤 / `late` 終盤 / `cleared` クリア済み /
  `post-clear` クリア後もやり込み中。API では任意 (旧クライアント・GLAB 経路の互換) で、
  未設定なら追加質問で聞く。
- 感情 (`sentiment`) は任意。送らなければ `null` (未回答) で保存し、0 にしない。

## 追加質問

`src/services/voiceFollowUp/followUpQuestions.js` の純関数 `nextFollowUpQuestion(record)` が、
回答済み・スキップ済みでない質問のうち、情報が欠けている最初の 1 問を返す。足りていれば `null`。

| 順 | id | 聞く条件 | 回答の反映先 |
|---|---|---|---|
| 1 | `playProgress` | 進度が未設定 | `playProgress` |
| 2 | `sentiment` | 感情が未回答 (`null`) | `sentiment` (-2〜2、0 = 中立) |
| 3 | `polarity` | スキ / 嫌いが未設定 | `polarity` (「どちらでもない」は回答だけ記録) |
| 4 | `reason` | 感想が 60 文字未満 | `followUps` のみ |
| 5 | `highlight` | 常に (一度だけ) | `followUps` のみ |
| 6 | `ending` | 進度が `cleared` 以上のときだけ | `followUps` のみ |

- 未プレイ範囲は質問しない: `ending` はクリア前のプレイヤーには出さない。
- 回答はすべて `followUps: [{ questionId, answer, answeredAt }]` に原文のまま残す。`comment` は変更しない。
- スキップは `skippedFollowUps` に記録し、同じ質問を再び出さない。途中で閉じても、記録カードの
  「追加の質問に答える」から続きを再開できる。
- 開いていない質問 (回答済み・スキップ済み・未到達範囲) への回答は 409 `FOLLOW_UP_NOT_OPEN`。

## API

| モード | 取得 | 回答 / スキップ |
|---|---|---|
| オンライン | `GET /api/v1/profile-data/voices/:id/follow-up` | `POST` 同パス `{ questionId, answer }` または `{ questionId, skip: true }` |
| ローカル | `GET /api/local/voices/:id/follow-up` | `POST` 同パス |

オンラインは `authenticate` 済みの本人の記録だけを `findOwned` で引き、`updateOwned` で更新する。
他人の記録 id は 404。応答は `{ record, question }` (次の質問、無ければ `null`)。

## 分析での扱い

- `personaEvidence/answeredSentiment.js` が未回答を `null`、中立を `0` として返す。
- 数値の感情寄与 (`emotionalEngagement`、メカニクス別の感情平均) は `null` の記録を除外する。
  明示的な中立 0 は低い感情シグナルとして従来どおり数える。
- スキ / 嫌い (`polarity`) があれば、未回答でも方向 (±1) として使う。嫌い + メカニクスの忌避シグナルも維持。
- 過去データは書き換えない (旧記録は既定値 0 で保存されており、中立として扱われ続ける)。

## 変えないこと

- ナラティブアークの生成条件 (同じプレイヤー・ゲームの感情曲線 2 セッション以上) は変更しない。
  1 件の声の補完でアークが完成したとは扱わない。
