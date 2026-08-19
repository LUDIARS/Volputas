---
task: game-insight-hotspots
project: Voluptas
kind: 実装
created: 2026-08-20
spec_links:
  - player-profile-server/spec/feature/game-insight.md
  - player-profile-server/spec/feature/narrative-arc.md
  - player-profile-server/spec/feature/emotion-capture-companion.md
---
# Volputas ゲーム洞察: 複数プレイヤーのホットスポット/脱落点 + Anatomia × 動画の改善提案 (neco 指示 2026-08-20)

## 指示 (原文)
1. Volputas で感情分析点を置いたあと、Anatomia と動画でゲームを解析して改善ポイントを提案できるようにする
2. プレイヤーごとの感情分析を合わせてホットスポットや脱落点を統計的に出せるようにする

## 対応表
| 指示 | 実装 | 場所 |
|---|---|---|
| 2 | 全プレイヤー分の感情曲線を読む `CohortReader`、絶対時間軸への正規化 `hotspotSeries`、プレイヤー 1 票のビン集計と hype/pain 抽出 `hotspotAggregate`、生存曲線と脱落ビン `dropoutAnalysis` | game-insight.md §入力 / §進行軸 / §集約 |
| 1 | 焦点選定 + ゲームマーカー/anchors 結合 `improvementContext`、Anatomia CLI 適合 `anatomiaClient` (context/find)、画面録画フレーム切り出し `frameExtractor` (ffmpeg)、プロンプト `improvementPrompt`、`GameInsightService.propose` → `proposal` 保存 | game-insight.md §改善提案 |
| 両方 | `POST /api/local/game-insights/analyze` / `/:id/propose` ほか、`GameInsightPage` + `HotspotChart` (ナビ「自分を知る > ゲーム洞察」) | game-insight.md §API / §UI |
| 基盤 | `ClaudeCliTextClient.generate({ imagePaths })` でフレーム単位の限定 `Read`、`AnthropicTextClient` で image block を付与、`.anatomia/domains/game-insight.json` | — |

## 設計判断
- ナラティブアーク (同一プレイヤー) は触らず、横断集計を別ドメインにした。進行軸は「各セッションを 0..1 に伸ばす」
  のではなく「最長セッションを基準にした絶対時間」。短いセッションの終端がそのまま脱落の証拠になる。
- プレイヤー 1 人 1 票 (セッション内平均 → プレイヤー間平均)。スタンプもプレイヤー数で数える。
- 他プレイヤーのデータはデータリポジトリの `emotion-curves/<name>/` に取り込まれたもの (読み取りのみ)。
  キャプチャセッション (マーカー・画面録画) は本人ディレクトリのものだけを使う。
- 明示指定したキャプチャ ID も対象ゲームとの一致を検証し、別ゲームの録画が提案へ混ざることを防ぐ。
- Anatomia / ffmpeg / LLM はすべて任意。未設定は `/status` で見え、集計自体は常に走る。

## 受け入れ条件
- サーバ側: `npm test` (gameInsight 7 本 + gameInsightRoutes) が通る
- フロント側: JSX が esbuild を通る (`vite build` はこの環境では `@mediapipe/tasks-vision` 未インストールで既存の別要因により失敗)
- Anatomia: `game-insight` ドメインが新規ファイルを覆う

## 残作業 (この PR の外)
- 実機確認: 複数プレイヤーの感情曲線を取り込んだデータリポジトリで集計 → 画面録画付きキャプチャ + `VOLPUTAS_ANATOMIA_CLI`
  を設定して提案生成 (Claude CLI のフレーム限定 `Read` または Anthropic image block で画像を参照できるか)
- 章・ステージ単位の進行軸 (ゲームマーカーが揃ってから)
- 他プレイヤーの感情曲線を取り込む手順 (現状は手動コピー。GLAB 経路からの取り込みは別 spec)
