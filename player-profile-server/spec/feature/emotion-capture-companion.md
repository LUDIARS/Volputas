# 感情キャプチャ・コンパニオン (ゲーム同期タイムライン + iPhone キャプチャ)

> Spec ID: `SPEC-EMOTION-CAPTURE-COMPANION`
>
> 状態: 実装 (2026-08-13)、追補 (2026-08-16: デスクトップキャプチャ・録画・事後視線推定・
> リプレイ・感情曲線の編集)。neco 指示「Volputas の感情分析補助ツールを用意する。ゲームから合図が
> あった、または自動で開始した Volputas はゲーム画面と同期したタイムラインを持ち、iPhone を通して
> アイトラッキングと音声のキャプチャを行う」および「感情分析処理を仕上げる (音声+映像キャプチャ →
> 事後の視線解析をゲーム画面に反映 → 録画アップロードでタイムライン → STT 感情曲線 → 人間が編集 →
> 複数プレイでナラティブアーク)」の設計。
> 関連: `emotion-curve-video-tool.md` (事後の感情曲線記入)、`narrative-arc.md` (複数セッションの集約)、
> `persona-engine-v2-design.md`。

## 目的

感情曲線 (事後の自己申告) を補助する **プレイ中の客観キャプチャ** を追加する。

1. **ゲーム合図で開始/停止** — ゲームがローカル API に signal を POST すると、Volputas が
   キャプチャセッションを自動開始・停止する。手動開始 (UI ボタン) も可。
2. **ゲーム画面と同期したタイムライン** — セッションは開始時刻起点の単一クロック
   (`sessionMs`) を持ち、ゲームが送る `gameClockMs` アンカーとマーカー (イベント/章区切り) を
   同じ軸上に記録する。
3. **iPhone キャプチャ** — ペアリングコードで iPhone を接続し、視線サンプル (アイトラッキング)
   と音声をセッションクロックに載せて収集する。

キャプチャは**ペルソナ evidence ではない** (下記「非目標」)。事後に感情曲線を書くときの
参照材料 (どこで盛り上がったか・どこを見ていたか・何を言っていたか) を提供する補助ツール。

## アーキテクチャ

```
ゲーム (同一 PC) ──POST /api/local/capture-sessions/signal──▶ Volputas local app (127.0.0.1)
デスクトップ UI ──/api/local/capture-sessions/*────────────▶      │ CaptureSessionService
                                                                  │   ├ ProfileRecordStore('capture-sessions')
iPhone (同一 LAN) ──/api/join /api/gaze /api/audio ───▶ companion listener (別ポート・opt-in)
```

- **メインの local app は 127.0.0.1 バインドのまま変えない** (認証なしのため)。
- iPhone 向けは **companion listener** という別 Express アプリ + 別ポートに分離する。
  companion listener が公開するのはペアリング済みトークンで守られた 5 エンドポイントと
  コンパニオンページだけで、プロフィール API には一切触れない。
- companion listener は `VOLPUTAS_COMPANION_PORT` を設定したときだけ起動する (opt-in)。
  非 loopback での待ち受けには TLS 証明書・秘密鍵を必須とし、ポート不正・TLS 設定不整合は
  起動時に fail-fast (§7.1/§9)。HTTP は loopback の開発・テスト用途だけで許可する。
- セッション更新はサービス内で直列化し、マーカー・視線バッチ・停止の同時要求が最後の書き込みで
  互いを失わないようにする。起動後の初回アクセスでは、前回プロセスの異常終了で残った
  `recording` レコードを `interrupted` に回復する。

## クロック同期

- 正本クロックはサーバの `sessionMs` (セッション開始からの経過 ms)。
- ゲーム: signal/marker に任意の `gameClockMs` を載せると `anchors[]` に
  `{ sessionMs, gameClockMs }` を記録。ゲーム内リプレイや録画とのオフセット解決は閲覧側で行う。
- iPhone: `POST /api/sync` に `clientSentAtMs` を送ると `sessionMs` が返る。クライアントは
  RTT/2 補正でオフセットを推定し、以後のサンプルを `sessionMs` に変換してから送る
  (NTP-lite。サーバはサンプルの clock 変換をしない)。

## データモデル

セッションレコード (ローカルデータリポジトリ `capture-sessions/<name>/<id>.json`):

```jsonc
{
  "schemaVersion": 1,
  "id": "uuid",
  "gameTitle": "...",
  "source": "game-signal" | "manual",
  "status": "recording" | "completed" | "interrupted",
  "startedAt": "ISO8601", "endedAt": "ISO8601 | null",
  "anchors": [{ "sessionMs": 0, "gameClockMs": 0 }],
  "markers": [{ "sessionMs": 0, "origin": "game" | "companion" | "desktop", "type": "hype|like|dislike|stress|event|note", "label": "任意" }],
  "devices": [{ "deviceId": "uuid", "joinedSessionMs": 0 }],
  "capture": { "gazeSampleCount": 0, "audioFileName": null, "audioDurationSeconds": null }
}
```

`interrupted` はプロセス再起動時に回復したセッションを表す。正確な終了時刻は分からないため
`endedAt` は `null` のままにし、タイムライン長は記録済みの視線・マーカーから求める。

- マーカー type のうち `hype/like/dislike/stress` は感情曲線のスタンプ (`EMOTION_STAMPS`) と
  同じ id。プレイ中のワンタップ記録が事後の感情曲線と同じ語彙で並ぶ。
- 視線サンプルは JSONL (`media/<name>/capture-gaze/<sessionId>.jsonl`)、1 行 =
  `{ "sessionMs": n, "x": 0..1, "y": 0..1, "valid": bool }` (x/y は画面正規化座標)。
- 音声はセッション全体で 1 ファイル (`media/<name>/capture-audio/<sessionId>.<ext>`)。
  webm/ogg/m4a/mp3/wav、最大 500MB。
- これらのメディアは evidence media レジストリ (`evidenceMedia.js`) に**登録しない**。
  レジストリは persona 分析と Cernere カラムに直結しており、キャプチャを登録すると
  Cernere 側の宣言 (`schema_definition`) 追加が必須になる。専用の
  `captureAudioStore` / `gazeSampleLog` で同じパス規約 (`profileDataPaths`) を使う。

## API

### local app (127.0.0.1、認証なし = 既存 local API と同じ前提)

| Method | Path | 動作 |
|---|---|---|
| PUT | `/api/local/capture-sessions/:id/audio` | この PC で録った音声 (companion `PUT /api/audio` と同じヘッダ契約、停止後・1 回限り) |
| PUT/GET | `/api/local/capture-sessions/:id/recordings/:kind` | `screen` / `face` 録画の保存 (`x-capture-start-session-ms` 必須、`-duration-seconds` / `-width` / `-height` 任意) と配信 |
| PUT | `/api/local/capture-sessions/:id/calibration` | 視線キャリブレーション窓の保存 (3〜25 点) |
| PUT/GET | `/api/local/capture-sessions/:id/gaze` | 事後推定の視線サンプル置換 (`application/x-ndjson`、`x-gaze-extractor` / `x-gaze-calibrated` 必須) と生サンプル取得 |
| PUT | `/api/local/emotion-curves/:recordId` | 感情曲線の人間編集 (§感情曲線の編集) |
| POST | `/api/local/capture-sessions/signal` | ゲーム合図。`action: start/stop/marker` |
| POST | `/api/local/capture-sessions` | 手動開始 `{ gameTitle }` |
| GET | `/api/local/capture-sessions` | セッション一覧 |
| GET | `/api/local/capture-sessions/active` | 進行中セッション (無ければ `data: null`) |
| POST | `/api/local/capture-sessions/active/markers` | デスクトップからのマーカー |
| POST | `/api/local/capture-sessions/active/stop` | 停止 |
| POST | `/api/local/capture-sessions/active/pairing` | 1 台限りのペアリングコード発行 (10 分有効) |
| GET | `/api/local/capture-sessions/companion/status` | companion listener の有効状態と接続先 URL 候補 |
| GET | `/api/local/capture-sessions/:id/timeline` | タイムライン (下記) |
| GET | `/api/local/capture-sessions/:id/audio` | 収録音声の再生 |

signal の `start` は進行中セッションがあるとき 409 (二重開始を無言でマージしない)。
`stop`/`marker` は進行中が無ければ 409。
すべての POST は `Content-Type: application/json` を必須とし、ブラウザの通常 form POST による
loopback API の操作を拒否する。

### companion listener (LAN、Bearer トークン必須)

| Method | Path | 動作 |
|---|---|---|
| GET | `/` | コンパニオンページ (自己完結 HTML、ビルド不要) |
| POST | `/api/join` | `{ code }` → `{ token, session }` |
| POST | `/api/sync` | クロック同期。`{ clientSentAtMs }` → `{ sessionMs, ... }` |
| POST | `/api/gaze` | 視線サンプルバッチ (最大 2000 件/回) |
| POST | `/api/markers` | iPhone からのワンタップマーカー |
| PUT | `/api/audio` | 収録音声のアップロード (停止後 10 分以内、1 セッション 1 回) |
| GET | `/api/session` | セッション状態のポーリング (停止検知用) |

- pairing code は 1 回の交換で失効し、`/api/join` は接続元ごとに 1 分あたり 5 回の失敗までに
  制限する。Bearer token は利用のたびに更新される 30 分の idle timeout を持つ。
- 停止時に未使用 code は失効し、token の期限は音声アップロード用の 10 分間に短縮する。
  新しいキャプチャセッションを開始した場合、その猶予期間も終了する。
- Helmet の CSP はリクエストごとの nonce を使い、自己完結ページの inline script だけを許可する。

## タイムライン (`GET /:id/timeline`)

`captureTimeline.js` の純関数で組み立てる (テスト対象):

- 5 秒ビンごとの視線集計: `n`, `validRatio`, `onScreenRatio`, `dispersion` (重心からの RMS 距離),
  `focusScore` (= onScreenRatio × (1 − min(2×dispersion, 1)))。
- マーカー・アンカーを同じ `sessionMs` 軸で返す。
- UI (`CaptureSessionPage`) は focusScore の推移 + マーカーを表示し、感情曲線記入時の
  参照に使う (SVG は `TrendChart` と同じ流儀)。

## iPhone 側の現実解

- **視線**: Safari にアイトラッキング API は無い。`POST /api/gaze` は ARKit
  (`ARFaceAnchor.lookAtPoint`) を使うネイティブコンパニオン (または他の視線計測器) 向けの
  取り込み口。コンパニオンページは視線については案内のみ表示する。
- **音声**: コンパニオンページが `MediaRecorder` で収録し、停止検知後に `PUT /api/audio` へ
  送る。`getUserMedia` は secure context 必須であり、Bearer token とキャプチャ内容自体も保護する
  ため、iPhone から接続する LAN listener は HTTPS 必須とする (自己署名証明書は iPhone 側で
  プロファイル信頼が必要)。

## 分析 (ローカル単独・自分のプレイデータ運用)

> 追補 2026-08-13: neco 指示「ローカル単独で感情分析が動くように。自分のプレイデータとして運用」。

キャプチャ済みセッションを **外部送信ゼロ** で感情分析し、既存のペルソナ経路に載せる。

```
capture-audio ──ffmpeg (16kHz mono WAV)──▶ whisper-stt (ローカル, POST /inference)
   └─ 発話 segments (audioStartSessionMs でセッションクロックへ) ──▶ sentiment-core (辞書)
        └─ analysis { utterances[{sessionMs, text, valence, arousal}] } をレコードに保存
             └─ 感情曲線レコード (mode: capture) を生成 → 既存ペルソナ分析が消費
```

- `src/services/captureAnalysis/` — `sttClient` (whisper.cpp 互換 `/inference`、
  verbose_json の segments、非対応サーバは全文 1 segment にフォールバック) /
  `audioToWav` (ffmpeg CLI、shell 非経由、temp WAV は全経路で削除) /
  `affectMapping` (sentiment-core → valence -2..2 / arousal 1..5 への純写像) /
  `captureAnalysisService` (オーケストレーション、provenance
  `extractor: "whisper-stt+sentiment-lexicon"` 付きでレコードへ保存・再実行で上書き) /
  `emotionCurveDraft` (マーカー→スタンプ entry、発話→コメント entry の純変換)。
- STT endpoint は loopback の HTTP(S) URL のみを受け入れ、redirect を拒否する。
  endpoint 自体は分析記録に保存しないため、データリポジトリにローカル構成を混入させない。
- 音声アップロードは `x-audio-start-session-ms` (コンパニオンが録音開始時の
  sessionMs を申告) を必須の分析前提とする。無い録音は
  `CAPTURE_AUDIO_UNANCHORED` で拒否し、推測で時刻を貼らない。
- 感情曲線に **mode `capture`** を追加 (動画なし・timeSeconds 軸・
  `captureSessionId` で由来を保持)。`sourceContributions` の記憶バイアス割引
  (memory=0.75) は適用せず weight 1 (プレイ中の実測のため)。evidence media
  レジストリは触らない — 感情曲線という登録済み媒体に変換して流すので、
  Cernere カラム追加なしで「ローカルの自分のプレイデータ」として完結する。
- API: `POST /:id/analyze` (STT+辞書分析)、`POST /:id/emotion-curve` (曲線生成、
  respondent 付与と `validateEmotionCurveInput` を通常経路と共有)、
  `GET /analysis/status` (STT/ffmpeg 設定状態)。
- LLM 評価は既存の感情曲線評価 (`claude-cli` 既定 = ローカル) をそのまま使う。

## デスクトップキャプチャ (追補 2026-08-16)

> neco 指示 (1)(2): 「Volputas 上で音声+映像をキャプチャ」「ゲームプレイを録画 (音声も)」。

iPhone が無くても、Volputas を開いている PC だけで完結するキャプチャ経路。`CaptureSessionPage` の
録画中カードに **この PC で録画** パネル (`CaptureDesktopPanel` + `useDesktopCapture`) を置く。

- **顔カメラ + マイク** — `getUserMedia({ video, audio })` を 2 本の `MediaRecorder` で記録する:
  映像+音声 (`video/webm`、事後の視線推定用) と音声のみ (`audio/webm`、STT 用)。同じストリーム
  なので開始時刻は同じ。
- **ゲーム画面 (音声込み)** — `getDisplayMedia({ video, audio: true })`。ブラウザ/OS の画面選択で
  ゲームのウィンドウか画面を選ぶ。Electron 版は `setDisplayMediaRequestHandler` (OS ピッカー優先、
  無ければプライマリ画面 + loopback 音声) を `desktop/main.js` に持つ。「共有を停止」は録画停止として扱う。
- **セッションクロックへの固定** — 各レコーダの `onstart` / `onstop` 時点の `sessionMs`
  (= `Date.now() − startedAt`。同一 PC なのでサーバと時計が一致) を控え、アップロード時に
  ヘッダで申告する。サーバは推測しない (音声の `CAPTURE_AUDIO_UNANCHORED` と同じ姿勢)。
- **停止順序** — 「セッション終了」はレコーダ停止 → `POST /active/stop` → アップロードの順。
  録画の終端がセッションクロック上に載り、アップロードは `completed` なセッションに対して行われる。
  ゲーム合図で先に停止された場合はポーリングで検知し、束縛していたセッション ID へ同じ順で送る。
- **事後アップロード** — OBS 等の外部録画・別端末の音声は完了後に `CaptureRecordingUpload`
  (種類 = screen / face / audio、セッション開始からのずれ秒) で追加できる。録画 (screen/face) は
  再アップロードで置き換え可、音声は 1 セッション 1 回のまま。

### 録画のデータモデル

`capture` に追加:

```jsonc
"capture": {
  "gazeSampleCount": 0,
  "gazeSource": "companion" | "face-video" | null,
  "audioFileName": null, "audioDurationSeconds": null, "audioStartSessionMs": null,
  "screenRecording": { "fileName": "<id>.webm", "contentType": "video/webm", "bytes": 0,
                        "startSessionMs": 0, "durationSeconds": 0, "width": 1920, "height": 1080,
                        "uploadedAt": "ISO8601" } | null,
  "faceRecording":   { ...同上 } | null
},
"calibration": { "schemaVersion": 1, "recordedAt": "ISO8601", "screen": { "width", "height" },
                 "points": [{ "x": 0..1, "y": 0..1, "fromSessionMs": 0, "toSessionMs": 0 }] } | null,
"gazeEstimation": { "schemaVersion": 1, "extractor": "mediapipe-face-landmarker+affine-calibration",
                    "calibrated": true, "fitError": 0.04, "frameRate": 15, "sampleCount": 0,
                    "estimatedAt": "ISO8601" } | null
```

- 録画ファイルは `media/<name>/capture-screen/<sessionId>.<ext>` / `capture-face/…`
  (`captureVideoStore`、webm/mp4/mov/mkv、最大 8GB、別拡張子での再アップロードは旧ファイルを消す)。
  音声・視線と同じく evidence media レジストリには**登録しない**。共通のストリーム→一時ファイル→
  rename は `captureMediaFile.js` に切り出し、音声ストアも同じ実装を使う。

## 視線推定 (追補 2026-08-16)

> neco 指示 (1-1)(1-2): 「後からプレイしている人間の視線を解析 (アイトラッキング)」「アイトラッキングは
> ゲーム画面に反映する」。ARKit ネイティブコンパニオンが無くても、顔カメラ映像から事後に推定する。

```
顔カメラ録画 ──(ブラウザ内再生 4x, 15fps 間引き)──▶ MediaPipe Face Landmarker (WASM, ローカル配信)
   └─ 478 点ランドマーク ──▶ gazeFeatures: [irisX, irisY, yaw, pitch, 1]
        └─ gazeCalibration: キャリブレーション窓のフレームで最小二乗 (リッジ付き) affine 当てはめ
             └─ 画面正規化座標 (x, y) を全フレームへ適用 ──▶ PUT /:id/gaze (NDJSON) で視線ログを置換
```

- **キャリブレーション** — 録画開始後に `GazeCalibrationOverlay` が全画面で 3×3 の 9 点を順に表示
  (settle 0.7 秒 + dwell 1.3 秒)。各点の dwell 窓を `sessionMs` で `PUT /:id/calibration` に保存する。
  推定は窓内のフレームだけで写像を学習するので、記録済み映像に対して何度でもやり直せる。
- **キャリブレーション無し** — `UNCALIBRATED_MAPPING` (虹彩位置が画面全体に対応する粗い写像) で
  推定し、`gazeEstimation.calibrated=false` と UI の「粗い推定」表示で正直に伝える。
- **モデルの配置** — `npm run build:frontend` が事前に `setup:gaze-model` を呼び、
  `@mediapipe/tasks-vision` の WASM を
  `frontend/public/mediapipe/wasm/` へコピーし、Face Landmarker モデルを一度だけ取得する
  (`VOLPUTAS_GAZE_MODEL_URL` は HTTPS の最終 URL のみ・redirect 拒否、または
  `VOLPUTAS_GAZE_MODEL_PATH` で差し替え可、gitignore 済)。desktop package も同じ build を通るため
  runtime/model を成果物へ必ず同梱する。解析時に
  外部へ出るものは無い。モデル未配置は `GAZE_MODEL_UNAVAILABLE` として **fail-fast** する。
- **視線ログの置換** — 事後推定は 1 件以上のサンプルを必須とし、`gazeSampleLog.replace` でファイルごと置き換え、
  `capture.gazeSource='face-video'` にする。ライブ (companion) サンプルと混ぜない。
- 純関数 (`gazeFeatures` / `gazeCalibration` / `gazeEstimationRunner` の throttle・NDJSON) は
  `frontend/src/lib/gaze/*.test.js` (node --test) で検証する。MediaPipe 呼び出しは
  `faceLandmarkerAdapter.js` の 1 箇所に閉じる。

## リプレイ (追補 2026-08-16)

> neco 指示 (3): 「ゲームプレイ終了後、(2) のデータをアップロードしてタイムラインを作成」。

`GET /:id/timeline` は `media` (screen / face / audio の `startSessionMs` / `endSessionMs`) と
`affect` (発話ごとの `sessionMs` / valence / arousal / text) を返すようになり、
`CaptureReplayView` が 1 つのセッションクロックで次を同期する:

- 画面録画 `<video>` (`GET /:id/recordings/screen`、Range 対応) を主クロックとし、`<canvas>` に
  直近 600ms の視線軌跡と現在の注視点を重ねる (`gazeOverlay.js`。画面外は縁にグレーで表示)。
  顔カメラ映像は小窓で追従。
- タイムライン SVG (注視スコア + 発話の感情価 + マーカー + 再生ヘッド) はクリックでシーク、
  マーカー・発話の一覧もクリックでシーク。
- 画面録画が無いセッションでも従来どおりタイムラインと音声プレーヤを表示する。

## 感情曲線の編集 (追補 2026-08-16)

> neco 指示 (5): 「(4) のデータを人間が編集可能にする」。

- `PUT /api/local/emotion-curves/:recordId` — 本文は作成時と同じ入力契約 (`validateEmotionCurveInput`)。
  `mode` / `captureSessionId` / `videoFileName` / `gameLogFileName` / `respondent` は保存済み
  レコードから引き継ぎ、本文の値は無視する (編集で別セッションへ付け替えない)。`editedAt` /
  `editCount` を刻み、既存の `evaluation` は残す (UI は `editedAt > evaluatedAt` を「編集後未評価」と表示)。
- UI: `EmotionCurveRecordCard` の「記録を編集」で `EmotionCurveEditor` を開く (ローカルモードのみ)。
  エントリの時刻/位置・スタンプ・感情価・強さ・進行アンカー・メモの修正、追加、削除、
  プレイ時間・申告ナラティブアーク等のメタデータ修正ができる。キャプチャ由来の機械ドラフト
  (発話 1 件 = 1 エントリ) を人間が整えてからペルソナ分析・ナラティブアークに載せる、が想定の流れ。

## 環境変数

| 変数 | 意味 |
|---|---|
| `VOLPUTAS_GAZE_MODEL_URL` / `VOLPUTAS_GAZE_MODEL_PATH` | `setup:gaze-model` の取得元 (未指定は Google 公開モデルバケット / ローカルファイル) |
| `VOLPUTAS_COMPANION_PORT` | 設定時のみ companion listener を起動 (1-65535 以外は起動失敗) |
| `VOLPUTAS_COMPANION_HOST` | バインド先 (既定 `0.0.0.0`) |
| `VOLPUTAS_COMPANION_TLS_CERT_FILE` / `_KEY_FILE` | 非 loopback listener では両方必須。片方だけは起動失敗 |
| `VOLPUTAS_STT_URL` | ローカル whisper-stt サーバ (例: LocalServices/whisper-stt)。正本ポートは Excubitor catalog。未設定時の分析は `STT_NOT_CONFIGURED` (503) |
| `VOLPUTAS_FFMPEG` | ffmpeg コマンド (既定 `ffmpeg`、不在は `FFMPEG_NOT_AVAILABLE`) |

## 非目標

- キャプチャセッション自体の evidence media レジストリ登録・Cernere
  `capture_session_records` カラム宣言 (感情曲線 mode `capture` への変換で代替)。
- 視線からの感情推定 (focusScore は注意指標に留める)。音量・韻律解析。表情 (blendshape) からの感情推定。
- 視線推定の精度保証 (単眼カメラ + affine 写像。ヒートマップ的な参照材料であり計測器ではない)。
- ゲームプロセスの自動検知による開始 (合図はゲーム側の POST に限る)。
- 録画のトランスコード・サムネイル生成 (ブラウザが再生できる形式のまま保存する)。
- online (認証) モードへの展開。本機能は local モード専用 (感情曲線の編集 API も local のみ)。
