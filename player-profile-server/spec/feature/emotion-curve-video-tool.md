# 感情曲線 動画ツール拡張 (スタンプ / ゲームログ / LLM 評価)

> 状態: 実装済み (2026-07-27)。neco 指示「動画をアップロードして感情曲線をメモるツール」の設計。
> 関連: `persona-engine-v2-design.md` §3.4 (T7 memory モード。本拡張は video モードの強化であり T7 とは独立、
> スキーマは衝突しない)。

## 目的

既存の感情曲線 (動画 + 時刻別 valence/arousal + コメント必須) を、次の 4 点で
「記入が軽く、分析が深い」ツールにする。

1. **スタンプ 1 タップ記入** — 動画再生中に「盛り上がり/スキ/嫌い/ストレス」をワンタップで記録。
2. **メモは任意** — 何が嫌か言語化できるときだけ書く。スタンプがあればコメント無しで保存可。
3. **ゲームログ添付 (任意)** — 動画に対応するゲームログをアップロードし、評価の裏付けに使う。
4. **LLM 評価** — ペルソナ分析と感情曲線 (+ゲームログ) を合わせて、ナラティブアークを言語化する。
   プレイ時間 (通算/セッション) を記録し、体験全体の中での位置づけを分析材料にする。

## データモデル

### スタンプ (`EMOTION_STAMPS`, `src/services/profileEvidenceSchemas.js`)

valence/arousal の円環モデルに写像する。既存のペルソナ分析 (`personaEvidenceAnalysis.js`) は
valence/arousal を読むため、スタンプのみの記録でも分析が成立する (分析側の変更なし)。

| id | ラベル | valence | arousal |
|---|---|---|---|
| `hype` | 盛り上がり | +2 | 5 |
| `like` | スキ | +2 | 2 |
| `dislike` | 嫌い | -2 | 2 |
| `stress` | ストレス | -2 | 5 |

### 感情曲線レコードの追加フィールド (すべて任意・後方互換)

| フィールド | 型 | 意味 |
|---|---|---|
| `entries[].stamp` | enum \| null | 上記スタンプ id。null なら従来通り |
| `entries[].comment` | string (任意化) | スタンプがあれば空可。スタンプ無しなら必須 (どちらも無い entry は 400) |
| `gameLogFileName` | string | 添付ゲームログの元ファイル名 |
| `totalPlaytimeHours` | number | このゲームの通算プレイ時間 (ナラティブアーク分析の文脈) |
| `sessionPlaytimeMinutes` | number | このセッションのプレイ時間 |
| `evaluation` | object | LLM 評価結果 (下記)。評価実行時にサーバが書く |

### `evaluation` オブジェクト

```jsonc
{
  "schemaVersion": 1,
  "extractor": "llm",              // provenance (persona-engine-v2 §4.4 の流儀)
  "model": "claude-opus-5",
  "text": "…Markdown…",
  "evaluatedAt": "ISO8601",
  "personaAnalyzedAt": "ISO8601 | null",  // どの時点のペルソナと照合したか
  "usedGameLog": true
}
```

## メディア

`ProfileMediaStore` に kind `gamelogs` を追加。text/plain (.log) / application/json / text/csv、
最大 100MB。保存レイアウトは既存 media と同一 (`media/<name>/gamelogs/<recordId>.<ext>`、
online は保護ストレージ + Cernere 側メタデータ経由)。ブラウザは `.log` を空 MIME で報告するため、
フロントは拡張子から MIME を補完して送る。

## API

| Method | Path (local / online) | 動作 |
|---|---|---|
| PUT | `/media/gamelogs/:recordId` | ゲームログ保存 (既存 media 経路) |
| POST | `/emotion-curves/:recordId/evaluate` | LLM 評価を実行し、レコードに `evaluation` を保存して返す |

evaluate は都度実行 (再実行で上書き)。ペルソナは保存済み `analysis/persona.json`
(online は `persona_analysis`) を読むだけで、再計算はしない (stale なら UI 側の分析導線で更新)。

## LLM 呼び出し

- backend は `src/services/llm/createLlmTextClient.js` で選択する
  (`VOLPUTAS_LLM_BACKEND`、既定 **`claude-cli`**)。
  - **`claude-cli` (既定)** — `src/services/llm/claudeCliTextClient.js`。ローカルの
    Claude Code CLI を `claude -p --output-format text` で起動し、プロンプトは stdin で渡す。
    API キー不要。CLI 不在なら `LLM_NOT_CONFIGURED` (503) で **fail-fast**
    (RULE_CODE §7.1: 無言スタブ禁止)。コマンドは `VOLPUTAS_CLAUDE_CLI` で差し替え可、
    モデルは `VOLPUTAS_LLM_MODEL` (未指定なら CLI 側の既定)。timeout 5 分。
  - **`anthropic` (明示 opt-in)** — `src/services/llm/anthropicTextClient.js`。
    `ANTHROPIC_API_KEY` 必須、未設定なら `LLM_NOT_CONFIGURED` (503)。
    モデルは `VOLPUTAS_LLM_MODEL` (既定 `claude-opus-5`)。サーバ側 fallback
    (`fallbacks: "default"`) を有効化し、ポリシー由来の refusal は推奨代替モデルで再実行される。
- **LLM 使用の明示**: UI (レコードカード) に「スタンプ・メモ・プレイ時間・ゲームログと
  ペルソナ分析を LLM (Claude) に送信して生成する」旨を常時表示する。送信されるのは
  当該レコードと保存済みペルソナ分析のみで、他レコードや認証情報は含まない。
- `src/services/emotionCurveEvaluationPrompt.js` — 純関数のプロンプト構築 (テスト対象)。
  ゲームログは先頭 20,000 文字に切り詰め。ペルソナ未分析時は「分析待ち」と明示させる。
- `src/services/emotionCurveEvaluationService.js` — 評価 1 回のオーケストレーション。
  local / online 両ルートから共用。

評価の出力構成 (プロンプトで指示):
1. ナラティブアークの分析 (起伏構造・ピーク/エンド・プレイ時間文脈)
2. スキ/嫌いの言語化 (時刻引用、メモ無しスタンプは推測と明示)
3. ペルソナとの照合 (合致点・意外な点)
4. 開発者への示唆

persona-engine-v2 との整合: LLM は opt-in 補助であり、決定的なペルソナ集計 (evidence 経路) には
一切書き戻さない。`evaluation` は表示用の派生物で、provenance (`extractor: "llm"`) を持つ。

## UI (`EmotionCurvePage`)

- 動画プレビュー直下にスタンプバー (4 ボタン)。タップで現在再生位置に entry 追加。
- entry 行 = 時刻 + スタンプチップ (トグル) + 強さ + 任意メモ。「メモだけ追加」も可。
- 通算プレイ時間 / セッションプレイ時間 / ゲームログ添付の入力欄。
- レコードカード (`EmotionCurveRecordCard`) に「AI でこの感情曲線を評価」ボタンと評価表示。
  `LLM_NOT_CONFIGURED` はキー設定を促すメッセージに変換。

## 非目標

- ~~動画なし memory モード~~ → **T7 で実装済み** (`mode: 'memory'`、`entries[].position` 0..100%、
  `entries[].progressLabel` 進行アンカー、分析は記憶バイアス分 weight 0.75 掛け)
- 動画・ログの機械解釈 (Vision / ログの決定的パース) — ログは LLM への文脈供給のみ
- 評価結果のペルソナ evidence への還流 (v2 パイプライン確立後に検討)
