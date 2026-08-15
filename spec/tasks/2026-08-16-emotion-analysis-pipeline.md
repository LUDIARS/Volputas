---
task: emotion-analysis-pipeline
project: Voluptas
kind: 実装
created: 2026-08-16
spec_links:
  - player-profile-server/spec/feature/emotion-capture-companion.md
  - player-profile-server/spec/feature/narrative-arc.md
---
# Volputas 感情分析処理の仕上げ (neco 指示 2026-08-16)

## 指示 (原文の流れ)
1. Volputas 上で音声+映像をキャプチャ
   1-1. 後からプレイしている人間の視線を解析 (アイトラッキング)
   1-2. アイトラッキングはゲーム画面に反映する
2. ゲームプレイを録画 (音声も録画)
3. ゲームプレイ終了後、(2) のデータをアップロードしてタイムラインを作成
4. (1) の音声を STT 解析して感情分析 → インゲーム中の感情曲線を生成する
5. (4) のデータを人間が編集可能にする
6. 何度かゲームプレイデータを収集してナラティブアークを作成・解析する
   (解析は 1 つのゲーム・同じプレイヤーで行うこと)

## 対応表
| 指示 | 実装 | 場所 |
|---|---|---|
| 1 | この PC で録画 (顔カメラ+マイク / 画面) `useDesktopCapture` + `CaptureDesktopPanel`、`PUT /:id/audio` / `PUT /:id/recordings/:kind` | emotion-capture-companion.md §デスクトップキャプチャ |
| 1-1 | 顔映像から事後推定: MediaPipe Face Landmarker (ローカル配信) + 9 点キャリブレーション + affine 当てはめ、`PUT /:id/gaze` (NDJSON) | 同 §視線推定 |
| 1-2 | リプレイで画面録画に視線を重ねる (`CaptureReplayView` + `gazeOverlay`) | 同 §リプレイ |
| 2 | `getDisplayMedia({audio:true})` 録画、Electron は display-media handler | 同 §デスクトップキャプチャ |
| 3 | 終了時自動アップロード + 外部録画の事後アップロード (`CaptureRecordingUpload`)、`timeline.media/affect` | 同 §リプレイ |
| 4 | 既存 (2026-08-13 whisper-stt + sentiment-core → mode `capture` 感情曲線) | 同 §分析 |
| 5 | `PUT /api/local/emotion-curves/:id` + `EmotionCurveEditor` | 同 §感情曲線の編集 |
| 6 | `narrativeArc/*` (正規化・集約・形状分類・LLM 解説) + `NarrativeArcPage` | narrative-arc.md |

## 受け入れ条件
- サーバ側: `npm test` (captureSession / captureAnalysis / narrativeArc / local routes) が通る
- フロント側: `npm --prefix frontend test` (gaze 純関数・録画ヘルパ・overlay) が通り `npm run build:frontend` が通る
- Anatomia: `emotion-capture-companion` / `narrative-arc` ドメインが新規ファイルを覆う

## 残作業 (この PR の外)
- 実機確認: 顔カメラ・画面共有・キャリブレーション → 視線推定 → リプレイの一連 (このマシンには物理カメラが無い)
- `npm run setup:gaze-model` の初回実行 (モデル取得) を運用手順へ
- 視線推定の精度改善 (頭部姿勢の 3D 化、瞬目除去の高度化) は精度要求が出てから
