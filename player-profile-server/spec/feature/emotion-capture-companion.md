# 感情キャプチャ・コンパニオン (ゲーム同期タイムライン + iPhone キャプチャ)

> Spec ID: `SPEC-EMOTION-CAPTURE-COMPANION`
>
> 状態: 実装 (2026-08-13)。neco 指示「Volputas の感情分析補助ツールを用意する。ゲームから合図が
> あった、または自動で開始した Volputas はゲーム画面と同期したタイムラインを持ち、iPhone を通して
> アイトラッキングと音声のキャプチャを行う」の設計。
> 関連: `emotion-curve-video-tool.md` (事後の感情曲線記入)、`persona-engine-v2-design.md`。

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

## 環境変数

| 変数 | 意味 |
|---|---|
| `VOLPUTAS_COMPANION_PORT` | 設定時のみ companion listener を起動 (1-65535 以外は起動失敗) |
| `VOLPUTAS_COMPANION_HOST` | バインド先 (既定 `0.0.0.0`) |
| `VOLPUTAS_COMPANION_TLS_CERT_FILE` / `_KEY_FILE` | 非 loopback listener では両方必須。片方だけは起動失敗 |
| `VOLPUTAS_STT_URL` | ローカル whisper-stt サーバ (例: LocalServices/whisper-stt)。正本ポートは Excubitor catalog。未設定時の分析は `STT_NOT_CONFIGURED` (503) |
| `VOLPUTAS_FFMPEG` | ffmpeg コマンド (既定 `ffmpeg`、不在は `FFMPEG_NOT_AVAILABLE`) |

## 非目標

- キャプチャセッション自体の evidence media レジストリ登録・Cernere
  `capture_session_records` カラム宣言 (感情曲線 mode `capture` への変換で代替)。
- 視線からの感情推定 (focusScore は注意指標に留める)。音量・韻律解析。
- ゲームプロセスの自動検知による開始 (合図はゲーム側の POST に限る)。
- online (認証) モードへの展開。本機能は local モード専用。
