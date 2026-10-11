---
task: 根拠付きの声の体験解析ツール
project: Voluptas
kind: 実装
created: 2026-10-10
memory_links: []
---
# 根拠付きの声の体験解析ツール

## 指示と範囲

necoの「よしじゃあこれで設計まとめて」「Voに声の解析ツールを実装する」に対応。
合意した全体設計から、Voの保存済みの声を解析・保存・表示する機能を実装する。
Diの母集団統計やdesign_gapの最終評価は本タスクへ暗黙に含めない。
目的・データ形式・認可・受入条件は[機能仕様](../feature/voice-experience-analysis.md)を正本とする。
全体設計は[設計方針](../plan/voice-experience/design.md)と[連携契約](../plan/voice-experience/data-contract.md)。

## 受入条件

- local / onlineとも、保存済みの本人の声を明示操作で解析できる。
- 体験、感情、D、評価、希望を分離し、原文根拠を表示する。
- 未言及・未体験・対象外・判定不能・明示的中立・賛否混在を潰さない。
- 根拠のある出来事順と感情方向だけを返し、時刻・強度を生成しない。
- 同版再利用、原記録変更の検出、解析失敗時の非保存を満たす。
- 認可境界・既存の原記録・既存20次元出力を維持する。
- 精度校正・母集団統計・Di連携の未実装を明示する。

## 検証依頼

Revisorでsrc/services/voiceAnalysis/voiceAnalysis.test.js、src/routes/voiceAnalysisRoutes.test.js、
src/services/llm/llmTextClient.test.jsおよび既存の声/追加ヒアリング関連テストを確認する。
セッション自身のテスト実行・サービス起動は別の明示許可とCc testing claimが必要。
実機受入はExcubitor管理の本体フォルダで行い、worktreeからサービスを起動しない。
