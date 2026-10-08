---
task: ユーザの声の追加ヒアリングと未回答/中立の区別
project: Voluptas
kind: 実装
created: 2026-10-09
memory_links:
  - E:/Document/Ars/session-logs/2026-10-09.md
---
# ユーザの声の追加ヒアリングと未回答/中立の区別

## 目的

neco の指示「Vo完成させる」に対応する。承認済み設計 (session-logs 2026-10-09 の Sol 報告) に従い、
感想投稿でタイトル・感想・プレイ進度を保存し、不足情報だけを一問ずつ補完する。

## 受入観点

- 初回保存 / 情報十分 / 追加回答 / スキップ・再開 / 未プレイ範囲を聞かない
- 本人の記録だけ更新できる / 原文 (comment) を保持する
- 未回答 (null) と中立 (0) を分析で区別する
- ナラティブアークの既存生成条件は変えない

## スコープ (編集可ディレクトリ)

- player-profile-server/src/services/voiceFollowUp/
- player-profile-server/src/services/personaEvidence/
- player-profile-server/src/services/profileEvidenceSchemas.js, personaEvidenceAnalysis.js
- player-profile-server/src/routes/profileEvidence.js, src/local/localRoutes.js
- player-profile-server/frontend/src/ (VoicePage, VoiceFollowUpPanel, profileClient, localProfile.css)
- player-profile-server/spec/feature/voice-follow-up.md
