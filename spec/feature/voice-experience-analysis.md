# 声の体験解析ツール

仕様 ID: SPEC-VOICE-EXPERIENCE-ANALYSIS

## 目的と境界

保存済みの感想と追加回答を、根拠付きの観測、計算用の疎ベクトル、レビュー内の体験アークに変換する。
合意した[全体設計](../plan/voice-experience/design.md)と[将来のDi契約](../plan/voice-experience/data-contract.md)の初期実装であり、以下のAPIだけが今回の実装対象。
既存20次元persona、sentiment-core、複数セッションのnarrative arcは変更しない。
design_gapはAの良さ・Dの有効性を評価する別の契約とし、声解析から最終得点を生成しない。

## ユーザ操作

「ユーザの声」の保存済みカードから「声を解析・結果を見る」を開く。
既存結果の取得ではAIを呼ばない。未解析または古い結果に対して、本文・追加回答・ゲーム情報のAI送信を確認して解析する。
解析した特徴、原文引用、場面、根拠のある順序、感情の区分変化、本人が述べたD→Aのつながり、未分類内容を表示する。
画面は機械抽出が未検証であることを明示する。引用一致は意味判定の正しさを保証しない。

## 実装API

baseはlocal `/api/local/voice-analysis`、online `/api/v1/profile-data/voice-analysis`。

| Method / path | 入力 | 応答data |
|---|---|---|
| GET /catalog | なし | revision, analysisRevision, axes, dimensions, projection |
| GET /:recordId | 所有する声ID | state, analysis, previousAnalyzedAt |
| POST /:recordId | application/json `{ "consent": true }` | 保存後の上記status |

`state`はnot_analyzed / complete / stale。completeは抽出と構造検証の終了であり、学術的妥当性や人手確認済みを意味しない。
staleのanalysisはnull。元の本文・追加回答・ゲーム情報、辞書版、抽出器版が一致する場合だけ保存結果を再利用する。
POSTだけがAIを呼ぶ。同じ記録の実行中の重複要求は409。解析中の原記録変更や保存先変更も409。
永続ジョブ、バックグラウンド自動再試行、意味上の誤りを人が編集する機能は今回含まない。

## データ契約

保存形式`vo-experience/1`、analysisRevision=`vo-voice-analysis/1`、catalogRevision=`vo-voice-features/1`。
トップレベルはid、voiceId、sourceRevision(SHA-256)、版、analyzedAt、model、sourceKind=self_report、analysisState=complete、
observations、axes、vector、arc、links、unclassified、coverage、limitations。

初期辞書はA 7、感情9、D 8、個別評価12、希望6の42項目、カテゴリの出現を表す102チャネル。
42/102は妥当性を実証した次元数でも固定上限でもない。項目辞書を増減するときは版を上げる。
辞書にない重要な内容はunclassifiedへ保持し、AI出力から項目を自動追加しない。
同じIDの意味やカテゴリ順序は同じ版で変更しない。項目別の人手評価により分割・統合を判断する。

- A/感情/D: absent / present。未記載をabsentにしない。
- appraisal: negative / neutral / positive。対象ごとの記述上の評価。
- preference: avoid / neutral / seek。今回の感情から安定した性格・属性を推定しない。
- observed以外はnot_experienced / not_applicable / unresolvedでvalue=null、根拠必須。
- not_mentionedは観測を生成せずaxes要約の状態にする。未解析と混同しない。
- observationはid, axisId, status, value, eventId|null, evidence, measurementMethod=explicit_text, calibratedConfidence=null。
- evidenceはsourceId、完全一致quote、Unicode code pointのstartInclusive/endExclusive、coordinate。
  sourceIdはcommentまたはfollowUp:index:questionId。重複引用はLLMがoccurrenceを指定し、サーバで位置を算出する。
- vectorはcatalogRevision, projectionRevision=category-presence/1, 昇順indices, values(すべて1), observedAxisIds。
  indicesはcatalog.dimensionsの位置。対立カテゴリは両方保持しmixedとして要約する。中立には独立チャネルがある。
  省略を測定値0へ変換しない。これは特徴の出現投影であり、体験強度や母集団平均の入力値ではない。
- coverageは記述を抽出できた項目数。抽出精度、回答率、母集団の網羅率ではない。

arcはreview_reportedのみ。eventsと原文で裏付けられたtransitionsを持つ部分順序で、循環を拒否する。
感情方向はnegative / neutral / positive / nullで、非nullにはvalenceEvidenceを要求する。
transition.directionは両端の区分の上下(-1/0/1)、不明はnull。隣接時刻や等間隔標本を意味しない。
durationMsとchangeRateはnull。補間、持続時間、強度、反転頻度、全体ピークを捏造しない。
linksはobservedなDとAへの参照、reported_link、causality=not_verified、evidence。

## 保管・認可・失効

| データ | 分類 / 権威 | 保存先・保護 |
|---|---|---|
| 辞書と投影規則 | master / Vo | src/services/voiceAnalysis/catalog.js。コード審査と版管理 |
| 原記録 | user / 既存の本人記録 | online Cernere、local 非公開データリポジトリ。原文は書き換えない |
| online解析 | user由来 / Vo | Cernere voices[].experienceAnalysis。findOwned/updateOwnedを使用し本人認証後のみ提供 |
| local解析 | user由来 / Vo | データリポジトリのvoice-analyses/{name}/{voiceId}.json。既存ProfileRecordStoreで原記録と分離して保存 |

localはconfiguredContextの非公開リポジトリ確認とrespondent.name照合を必須にする。
取得・生成・保存前・保存後に原記録の所有範囲と版を再確認する。元記録が消えれば結果は404となる。
local派生ファイルの物理消去は元のリポジトリ管理と一緒に行う必要がある。今回、削除APIやDiへの撤回通知は追加しない。
既存の汎用online記録取得にexperienceAnalysisが含まれる場合も、利用側はsourceRevisionと辞書版を照合する。
専用GETは古い結果を提供しない。全応答はprivate, no-store。
LLM入力は許可項目のみとし、respondentや本人ID、過去の解析は渡さない。自由文内の個人情報を自動匿名化したとは主張しない。
Claude CLI経路はこの解析でのみツール・MCP・スキルを無効化し、セッション履歴保存を無効化する。
根拠: [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference)。プロバイダ自体の保持規約は別途適用される。
生成失敗・不正な引用・未知軸・不正な関係はエラーとし、原文やprovider stderrを応答へ漏らさず、代替の偽結果を保存しない。

## 受入と検証境界

自動確認用コードは欠落/中立/混在、Unicode引用、未知軸、順序循環、D/A参照、所有者境界、
送信確認、更新検出、同版再利用、生成中の重複、失敗後の再実行、ツール禁止を対象とする。
手動受入は両モードで「保存→解析→原文引用確認→追加回答→stale→再解析」を確認する。
実プロバイダを使う精度・性能検証は、人/ゲーム/期間を分離した人手正解セットに対して、
項目別precision/recall、否定・賛否混在、欠落判定、順序の誤り、未分類率、p50/p95を測定する。
このPRは実データでの精度保証・処理速度達成を主張しない。

## 全体設計の残範囲

Di向け検索/集計/詳細API、本人単位の母集団統計、推定区間・欠落偏りの検証、同意撤回通知、
辞書の経験的校正、design_gapの評価器は別実装。新しい声解析だけで統計精度が担保されたとは扱わない。
