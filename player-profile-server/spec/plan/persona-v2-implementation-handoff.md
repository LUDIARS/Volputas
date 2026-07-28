---
type: plan
title: "ペルソナエンジン v2 実装引き継ぎ (T10-T16)"
description: "T1-T9 完了時点の実装配置と、T10 以降を Codex が実装するための作業指示書。"
service: volputas
domain: persona
status: in-progress
related:
  - ../../persona-engine-v2-design.md
updated: 2026-07-28
---

# ペルソナエンジン v2 実装引き継ぎ (T10〜T16)

**設計の正本は repo root の `persona-engine-v2-design.md`** (§番号は本書からの参照先)。
本書は「どこまで実装済みか」「残りをどう実装するか」「done の機械判定条件」を定める。

## 0. 作業規約 (全タスク共通・必須)

1. **テストを実行してから PR にする。** このリポに CI は無い。
   `cd player-profile-server && npm test` (node --test) が **fail 0**、
   `npm --prefix frontend run build` が成功していること。実行結果 (tests/pass/fail 行) を
   PR 説明に貼る。テスト未実行の PR は差し戻し。
2. **タスクごとに 1 ブランチ 1 PR (squash)。** base は main。マージ後ブランチ削除。
   PR タイトルは `feat(persona): v2 T<N> — <内容>`。
3. **フォーマット**: 既存コードのインデント・改行スタイルに合わせる。
   **1 行圧縮コードは禁止** (minify 風の詰め込みは差し戻し)。
4. **SRP / ファイル分割**: evidence 抽出は `src/services/personaEvidence/` に
   1 責務 1 ファイルで追加する。既存モジュールへの「ついで実装」をしない。
5. **テストは新規挙動を実測で検証する**: 「exports されている」だけの
   テストは不可。入力→出力の値まで assert する。
6. **決定性**: `Date.now()`/乱数を分析経路に入れない (`analyzedAt` は引数、
   選択ロジックの乱数は frontend のみ可)。
7. スキーマ変更時は `spec/data/data-schema.md` の表を更新する。
8. **evidence 経路の作法**: 新ソースは
   `{ axis, value(0..1), weight, source:{kind,id,field}, note? }` の
   EvidenceContribution 配列 (+必要なら aversionEvidence) を返す純関数 1 本
   → `analyzePersonaV2` に合流、が唯一のパターン。集約器や confidence を
   直接いじらない。

## 1. 実装済み (T1〜T9 = PR #37〜#45) と配置マップ

| 領域 | 場所 |
|---|---|
| v2 分析本体 | `src/services/personaEvidence/analyzePersonaV2.js` (persona.json v2 の唯一の出力) |
| 集約器 / confidence | `personaEvidence/aggregateContributions.js` (§5.1。high/medium/low/insufficient) |
| ソース別抽出 | `personaEvidence/sourceContributions.js` (gameplay/voice/emotionCurve/survey) |
| アンケート設問メタデータ | `personaEvidence/surveyAxisContributions.js` (axis 付き設問 weight2 + aversion) |
| テキスト解析 | `personaEvidence/aspectTextContributions.js` (sentiment-core asp.*、負言及→aversion) |
| 写像表 | `personaEvidence/axisMappings.js` (aspect/genre/emotionSeeks/Steam genre→軸) |
| 12 分類 (純関数) | `src/services/classificationEngine.js` (`classifyFromSurveyRecords`) |
| Steam evidence | `personaEvidence/steamContributions.js` (weight2.5、90日減衰、achiever confidence 降格) |
| mechanicReactions | `personaEvidence/mechanicReactions.js` (voice の mechanicIds+polarity) |
| ペアワイズ比較 | `personaEvidence/experienceCards.js` (30枚) + `comparisonContributions.js` (Bradley-Terry 決定的) |
| 履歴 (local) | `personaEvidence/analysisHistory.js` + `GET /api/local/persona/history` |
| evidence 数え方 | `personaEvidence/evidenceCount.js` (定義/steam を誤計上しない) |
| 15 軸 UI | `frontend/src/pages/PersonaPage.jsx` + `components/RadarChart.jsx` (points API) + `TrendChart.jsx` + `lib/personaAxes.js` |
| 比較 UI | `frontend/src/pages/ComparisonPage.jsx` (+ App.jsx/両 Layout の nav 登録済み) |
| Ludus 辞書 | `scripts/build-ludus-lexicon.js` → `frontend/src/data/ludus-lexicon.json` (43件) |

読み方: 新しい入力媒体を足すときは **T9 (#45) の diff が最良の手本**
(store 追加 → schema validate → readSources → contributions 純関数 →
analyzePersonaV2 合流 → evidence カウント → UI ページ → nav → テスト)。

## 2. 残タスク

### T10 カードソート (§4.2)

- Ludus 辞書 (`frontend/src/data/ludus-lexicon.json` の 43 メカニクス) を
  「刺さる / どちらでも / 苦手」の 3 山に分ける UI (`CardSortPage`)。
- 保存: 新コレクション `cardsorts` (T9 の `comparisons` と同配線:
  local `ProfileRecordStore('cardsorts')` / online `card_sort_records` カラム)。
  レコード形: `{ mechanicId, bucket: 'love'|'neutral'|'avoid' }` を 1 判定 1 レコード
  (上書きは同 mechanicId の最新を有効とする — 集計側で `updatedAt` 最新を採用)。
- 集計 `personaEvidence/cardSortContributions.js`:
  - `love` → そのメカニクスの `STEAM_GENRE_AXIS_MAP` ではなく **メカニクス→軸写像が無い**ため、
    T10 では mechanicReactions への合流 (+1) と、`axisMappings.js` に
    `MECHANIC_CATEGORY_AXIS_MAP` (カテゴリ dir → 軸。例 `action`→competitor/mastery,
    `rhythm`→mastery, `open-world`→explorer/autonomy 等) を新設して
    カテゴリ経由で軸へ weight 1.0。
  - `avoid` → aversion `mechanic:<id>` strength 0.7 (§4.2) + mechanicReactions へ -1。
- 機械判定: `npm test` green / cardsorts 保存→analyze で aversions に
  `mechanic:` エントリが出るテストがある / UI から 3 山操作可能。

### T11 スクリーンショット・クリップ注釈 (§4.3)

- 独立ページ `AnnotationPage`: 画像アップロード (`media` kind `screenshots` を流用) +
  `momentType: 'achievement'|'discovery'|'story'|'social'|'aesthetic'` (5択) + キャプション。
- 新コレクション `annotations` (local/online 両対応、T9 パターン)。
- 集計 `personaEvidence/annotationContributions.js`:
  momentType→軸 (`axisMappings.js` に `MOMENT_TYPE_AXIS_MAP`:
  achievement→achiever, discovery→explorer, story→narrative, social→socializer,
  aesthetic→narrative0.5+explorer0.5)、weight 1.0。キャプションは
  freetext として affect へ (analyzePersonaV2 の affect サンプルに合流させる —
  `collectFreeTextSamples` 互換の `{questions,answers}` 形に包むか、
  `computeAffectProfile` にサンプルを直接追加する小改修)。
- **画像内容の機械解釈 (Vision) はやらない** (§4.3 明記)。
- 機械判定: annotation 保存→analyze で該当軸に contribution / affect の
  sampleTexts が増えるテスト。

### T12 理想のゲーム企画 (§4.4)

- ページ `PitchPage`: タイトル + 本文 + 参考ゲーム (任意)。
  新コレクション `pitches`。
- 集計 `personaEvidence/pitchContributions.js`:
  - 本文 → affect (T11 と同じ合流方法)。
  - Ludus 辞書語彙 (nameJa/nameEn/id) の文字列一致で mechanicIds 抽出 →
    mechanicReactions (+1) + カテゴリ経由で軸 weight 1.0。
  - **企画を書いた事実自体**が `mtg.johnny` +0.6 / `style.autonomy` +0.6 (weight 1.0)。
  - opt-in LLM 補完 (`analysis.llmAssist`) は **後続**。T12 では決定的部分のみ。
- 機械判定: 本文に「ローグライク」を含む pitch→ mechanicReactions に該当 id、
  johnny/autonomy に contribution が立つテスト。

### T13 エクスポート v2 + 同意 (§6.1/§6.2)

- 同意トグル: local は `localConfigStore` に `researchExportConsent: boolean` (既定 false)、
  設定 UI (LocalSettingsPage) に追加。online はユーザ設定 (users テーブル or
  Cernere ユーザ設定 — 実装前に既存のユーザ設定格納場所を確認して合わせる)。
- `scripts/export-personas.js` を v2 形式へ更新 (設計 §6.1 の JSONL。
  pseudoId は既存 `pseudoId.js`、confidence low 以上の軸のみ、aversions、
  mechanicReactions、exportSpecVersion: 2)。**同意 false のユーザ/Name は出力しない**。
- online: `GET /api/personas/export` (project credential 認証は既存 delegation
  機構を踏襲 — `src/routes/delegations.js` の認証を参照)。
- 機械判定: 同意 off で export 0 件 / on で JSONL 各行に pseudoId があり
  実名・email・Name が **含まれない** ことを grep で確認するテスト。

### T14 母集団レポート取込 (§6.3) — **Di 側バッチ完了後**。着手前に Di の
`persona-bridge.md` (Discutere #202) の状態を確認。ブロック中は skip。

### T15 ボイスメモ (§4.5)

- 録音 (MediaRecorder) → media kind `voicememos` (audio/webm 等、上限 50MB) +
  手動文字起こしテキスト。文字起こし後は voice と同じ evidence 経路
  (`voiceContributions`) に流す (kind は 'voicememo' として provenance 区別)。
- 自動 STT はスコープ外 (transcriber インタフェースだけ切る)。

### T16 Di 議論ログ還流の受け側 (§4.6) — Di 側 (D1-D5) と同時。明示同意 +
アカウント紐付け必須。取込形式は Di `persona-bridge.md` §4 が正本。

## 3. 周辺 follow-up (v2 タスクと独立に着手可)

| 項目 | 内容 |
|---|---|
| Cernere `comparison_records` カラム | T9 の online 比較が動くために Cernere 側 managed project スキーマへカラム追加 (Cernere リポの migration。`volputas_profile_evidence_schema` 系列)。T10/T11/T12/T15 のカラムも同時に (`card_sort_records`, `annotation_records`, `pitch_records`, `voicememo_records`) |
| steam_app_meta lazy fetch (§3.2.1) | Steam 取込時に storefront `appdetails` を lazy fetch し appid→genres をキャッシュ (local: データリポ `steam/app-meta.json` / online: 新テーブル)。取得失敗はスキップ。`steamContributions` は `appMeta` 引数を既に受ける |
| online 履歴テーブル (§2) | `persona_analysis_history` (追記 only) + OnlinePersonaService.analyze で insert + 履歴 API。フロントの personaHistory() の online 分岐を外す |
| ludus-lexicon overlay | `frontend/src/data/ludus-lexicon.local.json` を読んでマージするローダ (§3.5 利用側オーバーレイ) |
| Lapilli #14 | sentiment-core の social アスペクト追加後、`sourceContributions.js` の social キーワード+極性ゲートをアスペクト経路に置換 |

## 4. Di 側 (D1〜D5)

Discutere `spec/feature/flow/persona-bridge.md` (PR #202 でマージ済みのはず。無ければ
PR #202 を参照) が正本。Vo 側 T13 のエクスポート形式が入力になる。

## 5. 検証コマンド (worktree 初期化込み)

```bash
# worktree を作る場合 (メインクローン直編集禁止)
cd E:/Document/Ars/Voluptas/player-profile-server
git worktree add E:/Document/Ars/.worktrees/voluptas-vX -b <branch> origin/main
cd E:/Document/Ars/.worktrees/voluptas-vX/player-profile-server
git submodule update --init --recursive
NODE_ENV=development npm install --include=dev
( cd lib/lapilli/packages/sentiment-core \
  && NODE_ENV=development npm install --include=dev && npm run build )
( cd frontend && NODE_ENV=development npm install --include=dev )

# 検証 (PR 前に必ず)
npm test                          # fail 0 を確認
npm --prefix frontend run build   # 成功を確認
```

マージは `gh api -X PUT repos/LUDIARS/Voluptas/pulls/<n>/merge -f merge_method=squash`
(worktree 存在中の `gh pr merge` は harness-guard に止められる)。
