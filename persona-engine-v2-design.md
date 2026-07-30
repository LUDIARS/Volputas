# ペルソナエンジン v2 設計 (evidence-persona-v2)

> 状態: ドラフト (2026-07-27)。2026-07-27 のペルソナエンジンレビュー (Vo/Di 横断) の全指摘への対応設計。
> 関連: `player-profile-backend-design.md` / Discutere `spec/feature/flow/persona-bridge.md` (対リポ側設計) /
> Ludus `spec/data/game-lexicon/` (メカニクス中央辞書)。

## 0. レビュー所見 (対応対象)

| # | 所見 | 対応節 |
|---|------|--------|
| R1 | 4 つの分析系 (8軸 evidence / 12分類 analysisEngine / 15軸 preferenceAxes / 20次元 affect) が併存し、UI には 8軸しか届かない | §2 |
| R2 | gamer-preference アンケートの設問メタデータ (`axis`/`dimension`/`scoring`) がペルソナ分析で無視される | §3.1 |
| R3 | Steam 連携 (所有ゲーム・プレイ時間) がペルソナ evidence に流れていない | §3.2 |
| R4 | Vo→Di ブリッジが v1 止まり (affect+traits のみ・手動ファイル渡し・同意ゲート無し。Di 側取込先は /admin/personas に既存 — 初版の「取込先が無い」は誤記) | §6 |
| R5 | キーワード一致の否定文非対応・文字数=内省などヒューリスティックの脆さ、スコア 0 と「データ不足」の非区別、根拠のトレース不能 | §3.3, §5 |
| P1 | プレイヤー視点の不足: ネガティブ証拠 / 相対選好 / プレイ文脈 / 課金行動 / 時系列変化 / 動画なし感情記録 | §3.4, §4 |
| P2 | 開発者視点の不足: メカニクス対応付け / 母集団内での位置 / 進行アンカー / 根拠トレーサビリティ | §3.5, §5, §6 |
| P3 | 表現媒体の拡張 (感想・感情曲線・アンケート以外) | §4 |

## 1. 設計方針

1. **決定的 (deterministic) を維持する。** v1 と同じく LLM なしで再現可能。LLM は明示 opt-in の
   補助抽出 (§4.4) のみ。fingerprint による再計算スキップも維持。
2. **軸語彙は 15 軸 (`preferenceAxisDefinitions.js`) を正準とする。** Discutere
   `persona-questionnaire.ts` の `PREFERENCE_AXES` と同一語彙であり、Vo↔Di の相互運用の土台。
   既存 8 軸は「行動証拠軸」として 15 軸へ写像し、写像できない 2 軸 (感情没入・内省) は
   表現特性 (engagement) として別区画に残す。
3. **全 evidence は出所付き (provenance)。** 集計後もどのレコードが各軸に何点寄与したかを保持し、
   UI から遡れるようにする。
4. **「無い」と「知らない」を区別する。** 軸ごとに confidence を持ち、証拠不足の軸は 0 ではなく
   「データ不足」を表示する。忌避 (negative) は独立のシグナルとして持つ。
5. **入力は増やすが、必須は増やさない。** 新媒体はすべて任意。既存 4 入力だけでも v1 相当の
   分析が出る (後方互換)。

## 2. persona.json schemaVersion 2

```jsonc
{
  "schemaVersion": 2,
  "modelVersion": "evidence-persona-v2",
  "analyzedAt": "...",
  "sourceFingerprint": "...",

  // 正準: 15 軸 (Di と共有語彙)。score は 0..1、confidence は §5.1 の算出。
  "preferenceAxes": {
    "style.explorer": { "score": 0.72, "confidence": "high", "evidenceWeight": 6.5 },
    "...": {}
  },

  // 表現特性 (15 軸に写像しない): 本人がどれだけ感情・言語で表出するタイプか。
  // 軸スコアの confidence 補正 (§5.1) にも使う。
  "engagement": {
    "emotionalEngagement": { "score": 0.55, "evidenceWeight": 4.0 },
    "reflection": { "score": 0.61, "evidenceWeight": 5.2 }
  },

  // 忌避シグナル (P1)。軸またはメカニクスに対する負の証拠。志向スコアとは独立。
  "aversions": [
    { "target": "mechanic:gacha-pity", "strength": 0.8, "sources": ["voice:abc123"] },
    { "target": "style.routine_tolerance", "strength": 0.6, "sources": ["survey:gamer-preference#q_routine"] }
  ],

  // 20 次元 affect (@ludiars/sentiment-core)。従来 affectProfile と同一空間。
  "affect": { "vector": [/* 20 */], "vectorSpecVersion": 1, "sampleTexts": 12 },

  // 12 分類 (MTG 心理型 + Caillois + Story)。analysisEngine から純関数抽出して合流 (§3.6)。
  "classification": { "gamer": {}, "mechanics": {}, "story": {} },

  // メカニクス反応 (P2)。Ludus game-lexicon の id を参照。
  "mechanicReactions": [
    { "mechanicId": "action/dodge-roll", "sentiment": 1.5, "sources": ["voice:def456", "emotion:ghi789#3"] }
  ],

  // 母集団文脈 (P2)。Di の population バッチが書き戻す (§6.3)。無ければ null。
  "population": null,

  "evidence": { "surveys": 3, "gameplay": 5, "voices": 8, "emotionCurves": 2,
                "steam": 1, "comparisons": 14, "annotations": 6, "pitches": 1 },
  "note": "入力済みデータから傾向を可視化する推定です。診断や人物評価ではありません。"
}
```

- **履歴**: `analysis/<name>/persona.json` (最新) に加え、再計算のたびに
  `analysis/<name>/history/persona-<analyzedAt>.json` を残す (P1 時系列)。オンラインは
  `persona_analysis_history` テーブル (追記 only)。UI は軸ごとのトレンド (折れ線) を出す。
- **8 軸→15 軸写像** (v1 互換読み替えにも使用):

| v1 (8軸) | v2 写像先 |
|---|---|
| exploration | style.explorer |
| mastery | style.mastery |
| completion | style.achiever |
| challenge | style.competitor (0.5) + style.mastery (0.5) |
| narrative | style.narrative |
| social | style.socializer |
| emotionalEngagement | engagement (写像しない) |
| reflection | engagement (写像しない) |

## 3. Evidence パイプライン v2

### 3.0 共通: EvidenceContribution

全ソースモジュールは以下を返す純関数に統一する (`src/services/personaEvidence/` に分割。
coding-conventions の SRP・ファイル分割準拠):

```js
// { axis: 'style.explorer' | 'engagement.reflection' | 'aversion:<target>' | 'affect' | 'mechanic:<id>',
//   value: 0..1 | vector, weight: number,
//   source: { kind: 'voice', id: '...', field?: '...' }, note?: '...' }
```

集約器 (`aggregateContributions`) が軸ごとの加重平均・provenance 一覧・confidence を組み立てる。
v1 の `add(accumulator, ...)` 直書きは廃止。

### 3.1 アンケート (R2 是正)

- `readSources` がアンケート回答と**設問定義** (`surveys/*.json` / online は `surveys` JOIN —
  `affectProfile.js` と同じ経路) を組で読む。
- 既存 `scorePreferenceAxes` (`preferenceAxes.js`) をそのまま evidence 化する:
  `axis` 付き設問の choice/scale スコア → 該当 15 軸へ weight 2.0 (自己申告として最重量)。
- `dimension` 付き設問 → 12 分類 (§3.6) へ。
- freetext → sentiment-core `textToVector` で affect へ (従来 `affectProfile` と同じ計算を
  evidence パイプに合流。`player_affect_profiles` の別立て再計算は廃止し、persona.json v2 の
  `affect` に一本化。既存テーブルは移行期間のみ併記)。
- genre / emotionSeeks / platform の choice 回答 → §3.7 のマッピングテーブルで軸へ (weight 1.0)。
- routine_tolerance / monetization_sensitivity 等で「強い否定側」回答は aversion にも記録する。

### 3.2 Steam (R3 是正)

新 evidence ソース `steam`。`steamModel` の所有ゲームスナップショットから決定的に特徴量を出す:

| 特徴量 | 計算 | 軸 |
|---|---|---|
| 集中度 | 上位1タイトルのプレイ時間 / 総プレイ時間 | style.mastery (高集中) / style.explorer (低集中=広食) |
| 広さ | プレイ済 (>2h) タイトル数の対数正規化 | style.explorer |
| 積みゲー率 | プレイ 0 分 / 所有数 | aversion 証拠にはしない。style.collector の正証拠 (買うこと自体が収集) + completion 系 confidence の減点材料 |
| 直近活性 | playtime_2weeks > 0 のタイトル数 | style.routine_tolerance |
| ジャンル分布 | `steam_app_meta` キャッシュ (§3.2.1) があれば genre→軸マッピング (§3.7) | 各軸 |

- weight は全体で 2.5 (受動データとして最重量クラス)。ただしスナップショットが 90 日より古い場合は
  0.5 に減衰し、UI に「Steam 再取込を推奨」を出す。
- **3.2.1 `steam_app_meta`**: appid→{genres[], tags[]} のキャッシュ。Steam storefront
  `appdetails` を取込時に lazy fetch し、local モードはデータリポジトリ `steam/app-meta.json`、
  online は新テーブルに保存。取得失敗・未取得はジャンル特徴量をスキップ (分析は止めない)。
- fingerprint にはスナップショット取得時刻を含め、ライブラリ更新で stale 判定が立つようにする。

### 3.3 テキスト解析の置換 (R5 是正)

- `containsAny` キーワード一致を廃止し、sentiment-core の **アスペクト次元** (`asp.*` 8 次元:
  story/social 等を含む) を使う。感想 1 件 → `textToVector` → アスペクト次元の活性を該当軸への
  contribution に変換する。語彙は lexicon.json に集約され、否定語の扱いも sentiment-core 側の
  極性計算に一元化される。
- 併せて sentiment-core に **否定窓ルール** が入っていることを前提とする (入っていなければ
  Lapilli 側 issue として起票し、それまでは「アスペクト活性 × 文全体の極性が負なら aversion に
  振り替える」ルールで代替する。「ストーリーが薄い」→ narrative 志向ではなく
  `aversion(mechanic/aspect)` 候補)。
- 「文字数=内省」は残すが上限を圧縮し (fullAt 400→600, weight 0.75→0.5)、engagement 区画
  限定にする。志向軸には流さない。
- スクリーンショット有無→探索 (+0.55) は廃止。§4.3 のアノテーション付きギャラリーが代替。

### 3.4 感情曲線の拡張 (P1)

- `videoFileName` を **任意** にし、`mode: 'video' | 'memory'` を追加する。
  - `video`: 従来通り。`timeSeconds` = 動画秒。
  - `memory`: 動画なしの記憶スケッチ。`entries[].position` = 体験全体の相対位置 0..100 (%)。
    UI は指/マウスで山谷を描き、頂点・谷にコメントを付ける方式 (ピーク・エンド前提の軽量版)。
- entries に任意の **進行アンカー** `progressLabel` (例「3章ボス」「チュートリアル直後」) を追加 (P2)。
  自由文字列 + 直近入力のサジェスト。開発者側集計はラベル文字列一致で行う。
- 分析側は mode によらず同一処理 (valence/arousal 平均は既存ロジック)。memory モードは
  weight 0.75 掛け (記憶バイアス分の減衰)。

### 3.5 感想 (voice) の拡張 (P2)

- 任意フィールド `mechanicIds[]` を追加。入力 UI は Ludus `spec/data/game-lexicon/features/`
  から生成した静的サジェスト辞書 (`data/ludus-lexicon.json` としてビルド時同梱、
  利用側オーバーレイ方針に従い Vo 側で追加語彙を重ねられる) から選択。
- 任意フラグ `polarity: 'like' | 'dislike'` を追加 (UI はワンタップ)。`dislike` +
  mechanicIds は aversion 証拠になる。sentiment スライダーとは独立 (sentiment は強度、
  polarity は方向の明示)。
- mechanicIds 付き感想は `mechanicReactions` に集計される。

### 3.6 12 分類の合流 (R1 是正)

- `analysisEngine.js` から分類計算を **純関数に抽出** (`classificationEngine.js`: 入力=回答+設問
  メタデータ、出力=12 分類スコア)。DB 依存部は online 用アダプタに残す。
- local モードでも同じ関数を使い、persona.json v2 の `classification` に合流する。
- これにより「4 系統併存」は解消: **persona.json v2 が唯一の出力**で、preferenceAxes /
  engagement / affect / classification はその区画になる。`player_affect_profiles` 単独再計算と
  8 軸単独表示は廃止 (v1 persona.json は読み替え表示のみ対応)。

### 3.7 マッピングテーブル (単一ファイル)

genre→軸、emotionSeeks→軸、Steam genre→軸、Ludus feature カテゴリ→軸 の写像は
`src/services/personaEvidence/axisMappings.js` に定数として一元化する (テスト対象)。
例: `gacha → style.collector 0.6 / style.monetization_sensitivity 0.4`、
`healing → style.relaxation 1.0`、`fighting → style.competitor 1.0`。

## 4. 新しい表現媒体 (P3)

すべて任意入力・独立ページ。ローカル=データリポジトリのコレクション、オンライン=Cernere 所有
(既存 profile evidence と同じ二層)。各媒体は §3.0 の contribution を返すモジュールを 1 つ持つ。

### 4.1 ペアワイズ比較 (comparisons)

- 「どっちが好き?」2 択スワイプ。比較対象は 2 種:
  (a) **登録済みゲーム同士** (gameplay/Steam から候補生成)、
  (b) **体験カード同士** (axisMappings に対応する定型カード ~30 枚: 「高難度を突破する」vs
  「物語の結末を見届ける」等)。
- 保存: `comparisons/<name>/<id>.json` `{ kind, itemA, itemB, winner, at }`。
- 集計: Bradley-Terry 簡易版 (反復 10 回固定・決定的) でアイテム強度を推定し、
  カードは直接軸へ、ゲームはそのゲームの genre/mechanics 経由で軸へ (weight 1.5)。
- 1 判定 5 秒・回数無制限。回答数が増えるほど confidence が上がる、最も費用対効果の高い媒体。

### 4.2 カードソート (Q ソート)

- Ludus lexicon のメカニクスカードを「刺さる / どちらでも / 苦手」の 3 山に分ける UI。
  「苦手」山は aversion の第一級の入力経路 (P1 ネガティブ証拠)。
- 保存: `card-sorts/<name>/<id>.json`。集計: 刺さる=+1 / 苦手=aversion 0.7、
  mechanicReactions にも反映。

### 4.3 スクリーンショット・クリップ注釈 (annotations)

- 既存 screenshotFileName を独立ギャラリーに昇格。1 枚ごとに
  `momentType: 'achievement' | 'discovery' | 'story' | 'social' | 'aesthetic'` (5 択) +
  キャプション。
- momentType → 軸 (achievement→style.achiever 等、axisMappings)。キャプションは affect へ。
  画像バイト列は既存メディアストア (local はリポ外 / online は保護ストレージ) のまま。
- 「何を残したくなるか」自体が証拠、という位置づけ。画像内容の機械解釈 (Vision) は
  **やらない** (決定性維持。将来やるなら別 spec)。

### 4.4 理想のゲーム企画 (pitches)

- 「あなたの理想のゲームを 1 本、自由に企画してください」1 ページ (タイトル + 本文 + 任意で
  参考にしたゲーム)。
- 集計: 本文 → affect。Ludus lexicon の語彙一致でメカニクス言及を抽出 → mechanicReactions +
  該当軸 (weight 1.0)。**企画を書いた事実自体** が mtg.johnny / style.autonomy へ +0.6 (weight 1.0)。
- 任意 opt-in (`analysis.llmAssist=true` 設定時のみ) で LLM がメカニクス抽出を補完する。
  既定 off。LLM 結果も contribution として provenance に `extractor: 'llm'` を残す。

### 4.5 ボイスメモ (voice-memos) — 実装フェーズ後段

- プレイ直後 30 秒〜の口頭感想を録音 → 文字起こし → 以降は voice と同じ処理。
- 音声バイトはメディアストア、文字起こしテキストのみ evidence。
- 文字起こしは provider pluggable (`transcriber` インタフェース)。既定は「手動貼り付け」
  (録音だけ保存し、テキスト化は本人が書く/貼る)。自動 STT の provider 選定は本設計の
  スコープ外 (LUDIARS 内の既存資産を確認して別途決める)。
- UI は録音ボタン 1 つ。書かない層の感情データを拾う目的なので、入力障壁を最小にする。

### 4.6 Discutere 議論ログの還流 — 実装フェーズ後段 (Di 側設計と対)

- 本人が Di の議論 (Web チャット / Discord) で発言した内容を、**明示同意 + アカウント紐付け**
  の上で voice 相当の evidence として取り込む。詳細は Di `persona-bridge.md` §4。
- Vo 側は取込エンドポイント/取込ファイル形式と同意設定のみ持つ。

## 5. Confidence・UI・トレーサビリティ (R5/P2)

### 5.1 confidence

軸ごとに `evidenceWeight` (総重量) と `sourceKinds` (寄与したソース種別数) から:

- `high`: weight ≥ 4 かつ種別 ≥ 2
- `medium`: weight ≥ 2
- `low`: weight > 0
- `insufficient`: weight = 0 → **UI はスコアを出さず「データ不足」+「この軸に効く入力」への導線**

engagement.reflection が低い人は自由記述系の weight が構造的に小さくなるため、
テキスト由来 contribution の不足だけでは confidence を 1 段階しか下げない (行動系ソースがあれば
そちらで担保する)。

### 5.2 provenance UI

- 各軸の詳細を開くと寄与レコード一覧 (種別・日付・寄与値・リンク) を表示。
  persona.json には軸ごと上位 20 件の contribution を保存 (全量は分析ログ
  `analysis/<name>/contributions-<analyzedAt>.json` に置き、UI の「すべて表示」で読む)。
- レーダーチャートは 15 軸 (confidence 色分け、insufficient はグレー欠け)。
  v1 の 8 軸レーダーは撤去。

### 5.3 履歴・トレンド

- §2 の履歴ファイルから軸ごとの推移を折れ線表示。「昔は対戦、今は物語」が見える。
- 再分析は従来通り手動トリガ + stale 表示。履歴は上限 100 件で古いものから間引き
  (最古と直近 20 件は常に保持)。

## 6. Vo→Di ブリッジ v2 (R4/P2)。詳細プロトコルは Di 側 `persona-bridge.md`

> 2026-07-27 訂正: v1 ブリッジ (Vo `scripts/export-personas.js` → Di `/admin/personas` 手動
> upload、user_id=`ext:voluptas:<hmac16>`) は両 main に既存。本節はその v2 拡張であり、
> エクスポート形式は既存の snake_case `user_id`/`affect_vector` 規約に合わせて拡張する
> (§6.1 の camelCase 表記は実装時に v1 互換の形へ寄せる)。

### 6.1 同意とエクスポート形式 v2

- 設定に「ペルソナの研究提供 (仮名化) に同意」トグルを追加 (local: localConfig / online:
  ユーザ設定)。**既定 off**。off のユーザ/Name はエクスポートに一切含めない。
- 形式 (JSONL、1 行 = 1 ペルソナ):

```jsonc
{ "pseudoId": "…",                       // 既存 pseudoId (HMAC)。実名・email・Name は含めない
  "affectVector": [/*20*/], "vectorSpecVersion": 1,
  "preferenceAxes": { "style.explorer": 0.72, "...": 0 },   // score のみ (confidence low 以上の軸)
  "aversions": [ { "target": "mechanic:gacha-pity", "strength": 0.8 } ],
  "traits": ["…"],                        // playstyle タグ (既存 buildPersonaExports 踏襲)
  "attributes": { "ageBand": "20s", "spending": "light" },  // 該当アンケート回答がある場合のみ
  "mechanicReactions": [ { "mechanicId": "…", "sentiment": 1.5 } ],
  "exportSpecVersion": 2 }
```

### 6.2 トランスポート

- **local**: `npm run export:personas` を v2 形式に更新し、データリポジトリ
  `exports/personas.jsonl` へ書き出す (回答と同じく自動 commit/push の対象)。Di は
  このファイルパス/リポを指定して取り込む。
- **online**: `GET /api/personas/export` (project credential 認証、Cernere 経由の
  サービス間認証は既存 delegation 機構を踏襲)。ページング付き JSONL ストリーム。
- どちらも**同意済みのみ**・pseudoId 仮名のみ。個人データ正本は動かさない
  (personal-data rule: 個人データは Cernere 単一情報源、ここで渡すのは仮名化済み派生値)。

### 6.3 逆方向 (Di→Vo): 母集団レポート

- Di の population バッチ (`persona:populations` 拡張) が、取り込んだ Vo ペルソナごとに
  「実クロール分布内での近傍密度・多数派/少数派判定」を `population-report.json` として出力。
- Vo は取込コマンド/エンドポイントで受け取り、persona.json v2 の `population` に書き戻して
  UI に「この嗜好は全体の中でどの位置か」を表示する。

## 7. 非目標 (このスペックでやらないこと)

- LLM によるペルソナ本文生成・性格描写 (Di 側の憑依 descriptor は Di 設計の範囲)。
- embedding ベースの affect (Di #125 の別トラック)。
- 画像・動画バイト列の機械解釈 (Vision)。
- Memoria の性格傾向 draft 連携 (Voluptas#14 系) の変更 — 既存フローのまま。

## 8. 実装タスク分解 (フルセット。着手順 = 依存順)

各タスクはテスト込み。T1–T6 が「新規データ収集なしで質が上がる」配線是正、T7 以降が拡張。

| # | タスク | 主対象 |
|---|---|---|
| T1 | evidence パイプライン骨格: `personaEvidence/` モジュール分割、EvidenceContribution、集約器、confidence、schemaVersion 2 出力、v1 読み替え、履歴保存 | §3.0, §2, §5.1 |
| T2 | アンケート配線是正: 設問メタデータ読込、scorePreferenceAxes 合流、freetext→affect 合流、affectProfile 一本化 | §3.1 |
| T3 | 12 分類の純関数抽出と合流 (local/online 両対応) | §3.6 |
| T4 | テキスト解析置換: sentiment-core アスペクト経由 + 否定→aversion 振替、axisMappings 新設 | §3.3, §3.7 |
| T5 | Steam evidence 化: 特徴量、app-meta キャッシュ、fingerprint 組込、鮮度減衰 | §3.2 |
| T6 | フロント v2: 15 軸レーダー + confidence 表示 + provenance ドロワー + トレンド + 「データ不足→入力導線」 | §5 |
| T7 | 感情曲線 memory モード + 進行アンカー | §3.4 |
| T8 | 感想拡張: mechanicIds サジェスト (Ludus 辞書同梱ビルド) + polarity + mechanicReactions 集計 | §3.5 |
| T9 | ペアワイズ比較 (ページ + ストア + Bradley-Terry 集計) | §4.1 |
| T10 | カードソート (ページ + ストア + 集計 + aversion) | §4.2 |
| T11 | スクリーンショット注釈ギャラリー | §4.3 |
| T12 | 理想のゲーム企画ページ (+ opt-in LLM 抽出) | §4.4 |
| T13 | エクスポート v2 + 同意設定 + online エンドポイント | §6.1, §6.2 |
| T14 | 母集団レポート取込 + UI | §6.3 (Di 側バッチ完了後) |
| T15 | ボイスメモ (録音 + 手動文字起こし + evidence 化) | §4.5 |
| T16 | Di 議論ログ還流の受け側 (同意 + 取込) | §4.6 (Di 側と同時) |

Di 側の対タスク (importer / descriptor 強化 / population バッチ / sentiment-core 一本化) は
`persona-bridge.md` に分解する。
