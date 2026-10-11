# 体験データの保存構造と連携契約

契約ID: VO-DI-EXPERIENCE-CONTRACT-1
通信形式: vo-experience/1（新設案、未実装）
関連: [設計方針と受け入れ条件](design.md)

## 1 論理データモデル

以下は論理エンティティ名。物理テーブル・Cernereカラムの追加は実装時に既存の保管規則へ対応づける。

| エンティティ | 識別と必須内容 | 任意・不明を許す内容 |
|---|---|---|
| VoiceRecord | voiceId、sourceRevision、sourceKind、recordedAt、原記録参照、権限・公開範囲 | gameId、gameVersion、playProgress、playOccurredAt、本人対応 |
| ExperienceUnit | unitId、voiceId、sourceRevision、scope(game/session/scene/event)、対象参照 | sessionId、sceneId、mechanicIds、時刻、進行位置、前後関係 |
| Observation | observationId、unitId、axisId、status、測定方法、根拠参照、解析実行ID | 型付きvalue、推定区間、校正情報 |
| AffectPoint | pointId、unitId、座標種別、感情成分のObservation参照 | 時刻・位置・ordinal、次点との接続可否 |
| ExperienceArc | arcId、revision、kind、sourceRefs、analysisRevision、出来事・関係・感情点参照、生成状態 | シーン整列、転機、数値指標、形状候補 |
| Projection | projectionId、入力版、catalogRevision、projectionRevision、analysisCoverage、計算用配列 | 認可された根拠参照 |
| Aggregate | queryHash、snapshotId、対象条件、統計単位、算法版、対象取得の完全性 | 軸別統計、区間、人数、抑制理由 |
| Evaluation | evaluationId、designGapDefinitionIdと版、入力snapshot、対象条件、判断状態 | A成立度、D関連、数値差分、不足情報、案の順位 |

IDは不変。本文や根拠に影響する訂正はsourceRevisionを更新する。derived→sourceの依存関係を保持する。recordedAt（記録日時）とplayOccurredAt（体験日時）を代用しない。本人対応がないレコードから人物IDを生成しない。

### Observationのvalue

valueはnumber、integer、boolean、category、interval、nullのいずれか。型・範囲・単位はAxisDefinitionで決まる。数値の観測誤差区間と、統計的な信頼区間は別フィールド。

- status=observedの場合だけ、辞書に合致する非nullのvalueを持つ。
- not_mentioned / not_experienced / not_applicable / unresolvedはvalue=null。
- 抽出・解析未完了はObservationの値にせずAnalysisRunの状態にする。
- 同じunit×axisに反対の観測があっても上書きしない。複数Observationを保持する。
- measurementMethodはself_report_scale、explicit_text、telemetry、model_inference等。explicit_textは本人の報告を文章から抽出したことを意味し、体験の客観測定を意味しない。
- evidenceRefsは原記録ID・版と原文範囲。文字範囲はUnicode code pointのstartInclusive/endExclusiveで定義する。省略・正規化された文字列には元文字列への対応表を持つ。
- model_inferenceはモデル・プロンプト版・推定根拠を必須にする。数値のcalibratedConfidenceは校正セット・手法の版とともに保存し、未校正ならnull。

## 2 辞書の契約

AxisDefinitionはaxisId（永続文字列）、catalog内の整数index、parentId、domain、説明、valueType、range/categories、unit、scaleVersion、zeroMeaning、allowedMeasurementMethods、normalizationRule、aggregationRule、適用条件を持つ。

domainはa_experience、affect、d_behavior、appraisal、preference。metadata（投稿量・抽出品質等）は別領域で、体験の点数へ混ぜない。大分類・小分類の階層と数値投影の次元を分離する。機能追加で同じaxisIdの意味を変更せず、新IDまたは互換性を明示した新scaleVersionを発行する。

辞書の公開版は不変。catalogRevisionは内容を識別できる値を使う。indexの並びはその版で固定する。Voが辞書の版を配布し、Diは同じ版を読む。編集者・定義根拠・変更理由を残し、LLMの自由出力を自動登録しない。

初期の項目設計例:

| 領域 | leaf項目候補 | 値の意味 |
|---|---|---|
| A | 上達実感、突破の達成感、発見、選択の主体性、自己表現、つながり | 各体験が報告されたか、尺度でどの程度か |
| 感情 | joy、fear、boredom、tension、valence、arousal | 出現、種類、本人尺度。感情の良し悪しとは別 |
| D | 再挑戦、戦略変更、協力、待機、資源温存 | 記述上の発生または計測値。方式を区別 |
| 評価 | 操作応答、説明の明瞭さ、失敗負担、報酬納得度 | 対象ごとの賛否・尺度 |
| 希望 | 探索、競争回避、希望プレイ時間 | 本人の希望。体験の観測とは別 |

これは全項目を確定した辞書ではない。全leaf項目と尺度の確定は実データの人手分類で行う。大分類の名称が揃うだけで異なる尺度を結合しない。

## 3 疎ベクトルと計算用投影

正本はObservation。Projectionは、集約規則が定義された対象単位・項目だけを計算用に取り出す派生物。

~~~text
catalogRevision
projectionRevision
unitRef / sourceRevision
indices: 昇順で重複しない整数項目index
values: indicesと同じ長さの数値配列
observationRefs: 各成分の根拠となる観測ID群
analysisCoverage: 解析済み項目・対象範囲と実行状態
missingStates: 明示的に区別する欠落理由
~~~

indicesに含まれる値はすべて有効。中立の0は含め、欠測のための0は入れない。省略された項目は、analysisCoverageとmissingStatesを見なければ未解析か未言及か判別できない。Diは省略を一律に未言及へ変換してはならない。

カテゴリ値は辞書で定義したone-hot等へ投影できるが、カテゴリ番号を大小関係のある数値として引き算しない。mixedを0へ投影しない。複数の反対観測がある場合は、定義済みの肯定・否定・中立・mixed成分や内訳を用いる。特徴の抽出確信度は体験成分とは別。

通常転送はJSON。初版は独自バイナリ形式を導入しない。必要な成分だけを選び、辞書の文字列は各行で繰り返さず整数indexを用いる。大量転送時のJSONL・列形式は実測後の追加契約とし、初版に暗黙の形式を混ぜない。

重み付き距離を使う場合、同じ尺度へ正規化可能な共通有効項目Jで計算する。

~~~text
d² = Σ[j∈J] w[j] (x[j] − y[j])² / Σ[j∈J] w[j]
coverage = 比較できた重み / 比較対象として指定した重み
~~~

Jが空、重み合計が0、必須項目が不足の場合はdistance=null。結果にJとcoverageを含める。欠測自体を類似度の肯定証拠にしない。ランキング時は比較対象と最低カバレッジのポリシーを固定する。異なるJのスコアに無条件な全順序を付けない。

## 4 アークのデータ契約

kindはreview_reported、session_observed、multi_session。

coordinateは次のいずれか。

- session_ms: sessionIdと時間原点、timeMsを持つ。異なる動画・ログとの整列方法を記録。
- reported_progress: 本人が示した進行位置。実時刻への変換はしない。
- ordinal: 明示された出来事の前後だけ。均等な経過時間を意味しない。
- unknown: 関係が確定していない。曲線化せず点・出来事だけを返す。

出来事の関係にはbefore、overlaps、reported_link等を付け、順序関係と本人が説明する因果関係を分離する。順序が矛盾する場合はunresolvedとし、黙って並べ替えない。

metricごとにvalue/null、eligibleSegments、coverage、methodRevision、smoothing、reasonを持つ。全体のconfidence一つで曲線全体の正確さを表さない。変化速度には時間単位と時間区間、反転数には点の間隔と有効な接続条件が必要。

review_reportedの短い例:

~~~json
{
  "kind": "review_reported",
  "coordinate": "ordinal",
  "events": [
    {"id": "e1", "order": 1, "description": "何度も失敗した", "evidenceRef": "ev1"},
    {"id": "e2", "order": 2, "description": "敵の動きを覚えた", "evidenceRef": "ev2"},
    {"id": "e3", "order": 3, "description": "倒せて嬉しかった", "evidenceRef": "ev3"}
  ],
  "durationMs": null,
  "changeRate": null,
  "limitations": ["elapsed_time_unknown"]
}
~~~

例は説明用の抜粋であり、未知の強さ・時刻を追加していない。実データでは共通ID・版・観測参照も必要。

## 5 Di向け取得API

すべて新設案。既存の/api/personas/impressionsやpersona export v2を同じ意味のまま上書きしない。認可は現行の共有範囲を引き継ぎ、別用途の権限を自動付与しない。

| API | 入力 | 出力 |
|---|---|---|
| GET /api/experience/v1/catalog | revision（省略時は対応する現行版） | immutableな辞書と対応projection版 |
| POST /api/experience/v1/search | gameId、議題、期間・版・進度、軸選択、limit、cursor | 関連する声・特徴・関連度・根拠参照。selection.mode=retrieval |
| POST /api/experience/v1/aggregate | 対象条件、軸、統計単位、測定方法、推定方法 | 対象統計と品質情報。retrieval順位を母数にしない |
| POST /api/experience/v1/details | voice/arc等のID、sourceRevision、snapshotId、必要フィールド | 許可された根拠・イベント・感情点・アーク |

重いaggregateは202とjobIdを返し、GET /api/experience/v1/jobs/:jobIdで状態を取得できる設計とする。計算未完了を空の集計として返さない。job結果取得にも認可を再確認する。

共通応答:

~~~text
formatVersion = vo-experience/1
catalogRevision
analysisRevision（異なる解析版を含む場合は群を明示）
snapshotId
selection: mode、filters、unit、sampling、populationScope
completeness: complete/partial、理由、取得上限・取得時点
items または aggregate
nextCursor: 続きがなければnull
cachePolicy
~~~

page limitは1..200、cursorは不透明な値。cursorには対象条件・権限範囲・snapshotをサーバ側で結びつける。途中で条件を変更したcursorは拒否する。固定snapshotを維持できなくなった場合は明示的に失効を返し、別snapshotのページを混ぜない。

snapshotは取得時点の整合性の識別子であり、削除・同意撤回後も読む権利ではない。撤回があればsnapshotのアクセスを失効させる。

catalog等の未知版、index重複、配列長不一致、非有限値、範囲外、根拠版不一致は明示的エラー。未対応major形式は拒否する。形式内の追加メタデータを無視できても、未知の測定尺度を既知のものへ読み替えない。

サービス接続失敗は503等のエラー、ゼロ件は正常応答、権限不足は認可エラーとして分ける。本文と根拠のアクセス権は同じ境界に従う。

## 6 統計応答

Aggregateには以下を持つ。

- estimand: 何を推定・記述するか。例「指定ゲーム版で、その項目に回答した人の評価」。
- cohort: ゲーム・期間・進度・情報源・測定方法・項目版・除外条件。
- unit: person_game_period / voice / session等。
- nRecords、nPersons（不明ならnull）、nEligible、nObserved、欠落状態別件数、未解析数。
- mean・variance（適用可能な尺度のみ）、categoryCounts、mixedCount。
- interval: lower、upper、level、method、clusterUnit、assumptions。計算できなければnullと理由。
- weighting: 重みの目的・算法・基準母集団・版。無補正なら明示。
- coverage、suppression、biasWarnings、sourceCompleteness。

nObservedは宣言した統計単位の件数。1人の複数文の賛否をまとめる規則を版管理する。文単位の分布と人単位の分布を同じ分母で表示しない。

通常の等重み集計はn、mean、M2、カテゴリ件数を持つ安定した更新可能状態を用いる。重み付きの場合はsumW、sumW2等も保持するが、Kish型の重み有効件数だけで人物内相関や抽出偏りを解消した扱いにしない。訂正・削除は人単位の旧寄与を置き換え、必要に応じ該当集計を再構築する。

クラスタ再標本化等の推定区間はVo内で計算し、Diは表示・利用する。無作為抽出でない声の区間は母集団代表性を保証しない。補完・モデル推定の統計は直接観測の統計と別結果として返す。

## 7 キャッシュと更新

キャッシュキーは権限範囲・権限版、queryHash、snapshot、catalogRevision、projectionRevision、analysisRevisionを含める。認可変更を数値のTTLだけに任せない。

- 原文・詳細は既存のno-storeを初版の既定とする。
- 新形式の数値結果も既定no-store。明示された認可ポリシーで許された場合だけ、Diの保護されたメモリキャッシュを最大300秒とする。この上限は実装用の初期設定で、性能達成値ではない。
- キャッシュ再利用前に権限版と失効状態を確認する。確認不能なら利用しない。
- 原記録訂正時は依存Projection/Arc/Aggregateをstale化する。再計算前の結果を現行結果として返さない。
- 削除・同意撤回時は派生物を非提供化し、連携先のキャッシュ・索引を消去する。新旧経路の持ち越しコピーも追跡対象。
- 消去通知にはID・版だけを含め、消した原文を再送しない。通知漏れの再照合手段を実装で用意する。

Diは数値結果を永続保存して匿名データと呼ばない。監査に必要な参照・入力版も既存の保持・削除ポリシーに従う。固定snapshotの要求と削除要求が衝突した場合は削除・失効を優先する。

## 8 データ分類と保存先

| データ | 分類 | 権威・保存先 | 保護 |
|---|---|---|---|
| 項目辞書・尺度・投影規則 | master | Voが公開する版付き契約。定義は仕様・パッケージとして管理 | 改訂権限・版の完全性 |
| オンラインの本人記録・本人対応 | user | 既存Cernere管理データ | 本人・既存共有範囲の認可。Diへ本人IDを送らない |
| ローカルの声・本人記録 | user | Voローカルストア | ローカルの権限・既存保存ポリシー |
| 個人に紐づく観測・アーク・投影 | user | 各原記録の保護境界内のVo管理派生ストア。オンラインのユーザ属性はCernere境界を維持 | 原記録と同じ認可・削除・保持期限 |
| Vo集計・検索索引 | user由来 | Vo管理の再生成可能ストア。本人単位の計算は保護境界内 | 元データの利用範囲、集団抑制、更新・失効 |
| Di取得結果 | user由来 | 既定保存なし。明示許可された数値だけ最大300秒のメモリキャッシュ | 権限照合・失効・ログへ本文や本人情報を出さない |
| design_gap定義と結果 | master / user由来 | Diの議題・評価定義。入力体験の正本はVo | 結果も根拠データの共有範囲を継承 |

派生物の保持期限は元データ・同意の範囲を超えない。公開可能な集計へ変換する条件は別途確定し、未設定のまま公開しない。実装PRでは具体的なカラム・ストアをこの表へ対応づける。

## 9 照合した既存資料

- Voluptas/spec/feature/glab-impression-export.md: SPEC-GLAB-IMPRESSION-EXPORT、本文中心の匿名export、no-store。
- Voluptas/player-profile-server/spec/feature/narrative-arc.md: SPEC-NARRATIVE-ARC、同一人・同一ゲームの複数セッション、既存ローカル実装。
- Voluptas/player-profile-server/src/services/profileEvidenceSchemas.js: 声の未回答、進度、感情曲線の入力。
- Voluptas/player-profile-server/src/integrations/cernere/profileEvidenceStore.js: オンライン正本へのアクセス境界。
- Voluptas/player-profile-server/src/services/personaExport.js: 20次元affectと別の好み・属性を持つexport v2。
- Voluptas/player-profile-server/src/services/gameExperienceScales/scaleDefinitions.js: 独自文言を含む既存尺度。尺度名だけで互換性を判断しない。
- Discutere/spec/feature/flow/user-voices.md、src/flow/user-voices/voluptas-impressions.ts、game-voices.ts: 取得、匿名値、検索順位、類似ゲーム混合。
- Discutere/src/flow/design-gap.ts、improvement-score.ts、effect-predict.ts: 既存の固定次元・射影による採点。
- [AAPOR Disclosure Standards](https://aapor.org/standards-and-ethics/disclosure-standards/): 対象範囲・重み・クラスタ等の開示。
- [Sterne et al 2009](https://pmc.ncbi.nlm.nih.gov/articles/PMC2714692/): 欠落仮定、補完の限界、感度分析。本設計の項目辞書の妥当性を裏付けるものではない。

## 10 実装前に確定する内容

全leaf項目・尺度、物理スキーマ、権限スコープ名、失効配信経路、保持ポリシーの具体設定、人手評価セット、精度・性能の合格値を確定する。本書はそれらが実装済み・検証済みとは主張しない。
