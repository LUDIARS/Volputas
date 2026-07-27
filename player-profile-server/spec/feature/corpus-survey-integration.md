---
type: feature
title: "Corpus survey integration"
description: "Corpus/GLAB panelから、Cernere本人認証を保ったままVoluptasのアンケートを表示・回答する。"
service: voluptas
domain: survey
tags:
  - corpus
  - glab
  - cernere
status: implemented
related:
  - ../plan/corpus-survey-integration.md
  - ../interface/corpus-survey-backend.md
  - ../setup/corpus-survey-integration.md
  - ../test/corpus-survey-integration.md
  - ../data/data-schema.md
updated: 2026-07-24
---

# Corpus survey integration

## User story

Cernereへログイン済みのCorpus利用者として、Voluptasへ別途ログインせずに、GLABのレビュー
panelからゲームレビュー、ゲームアンケート、ほかの人への質問を一覧・回答したい。

## 振る舞い

1. GLABがCernere user access tokenからVoluptas向け短命project-tokenを発行する。
2. VoluptasはCernere公開鍵、audience、`kind=user_for_project`、
   `projectKey=volputas`、UUID subjectを検証する。
3. Voluptasは有効かつ`visible_to_glab=true`の設問だけを返す。
4. 回答済み状態と本人回答はVoluptas project WebSocketからCernereへ問い合わせる。
5. 回答送信時はVoluptasが設問定義に対して型・範囲・選択肢・必須回答を検証する。
6. Cernereが回答を設問単位のTEXTまたはINTEGERとして保存する。

## Categories

- `game_review`
- `game_survey`
- `peer_question`

未知categoryは空一覧へ縮退せず`400 INVALID_SURVEY_CATEGORY`で拒否する。

## Failure behavior

- token欠落・不正: `401 CERNERE_UNAUTHORIZED`
- Cernere/Voluptas必須設定欠落: `503 CORPUS_INTEGRATION_UNAVAILABLE`
- 公開対象外または不存在のsurvey: `404 NOT_FOUND`
- 回答形式不正: `400 INVALID_SURVEY_RESPONSE`
- JSON構文不正: `400 INVALID_JSON`
- Cernere接続失敗: `502 CERNERE_UPSTREAM_ERROR`

回答値、project credential、project-tokenをエラー本文やログへ含めない。
保護endpointは`Cache-Control: private, no-store`を返し、rate limitはCorpus proxyの
送信元IPに粗いabuse上限を置いたうえで、通常の利用枠を検証済みCernere `sub`単位で適用する。

## Identity separation

Corpus経路の本人anchorはCernere `sub`である。local OKF CLIのGitHub numeric IDとは自動的に
同一視しない。両経路は保存先も別で、暗黙のdual-writeを行わない。
