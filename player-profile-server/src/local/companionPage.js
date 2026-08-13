// Self-contained companion page served to the iPhone by the companion
// listener. Deliberately build-free vanilla HTML/JS: the phone only needs
// pairing, clock sync, one-tap markers, and (on HTTPS) audio recording. Gaze
// ingestion is an API for the native ARKit companion, so the page only explains
// it (spec/feature/emotion-capture-companion.md).
const COMPANION_PAGE_HTML = /* html */ `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title>Volputas Capture Companion</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, system-ui, sans-serif; margin: 0; padding: 16px;
         background: #101418; color: #e8ecf0; }
  h1 { font-size: 1.1rem; margin: 0 0 12px; }
  .card { background: #1a2027; border-radius: 12px; padding: 14px; margin-bottom: 12px; }
  .muted { color: #93a1af; font-size: 0.85rem; line-height: 1.5; }
  input { width: 100%; box-sizing: border-box; font-size: 1.4rem; letter-spacing: 0.3em;
          text-align: center; padding: 10px; border-radius: 10px; border: 1px solid #35404c;
          background: #0d1116; color: inherit; }
  button { width: 100%; font-size: 1rem; padding: 12px; margin-top: 10px; border: 0;
           border-radius: 10px; background: #2f6fed; color: #fff; }
  button:disabled { background: #35404c; color: #93a1af; }
  .stamps { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .stamps button { margin-top: 0; font-size: 1.05rem; padding: 16px 8px; }
  #stamp-hype { background: #d97706; } #stamp-like { background: #16a34a; }
  #stamp-dislike { background: #64748b; } #stamp-stress { background: #dc2626; }
  .status { font-variant-numeric: tabular-nums; }
  .error { color: #f87171; font-size: 0.9rem; min-height: 1.2em; }
  .hidden { display: none; }
</style>
</head>
<body>
<h1>Volputas Capture Companion</h1>

<div id="join-card" class="card">
  <p class="muted">デスクトップの Volputas に表示されたペアリングコードを入力してください。</p>
  <input id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000">
  <button id="join">接続する</button>
  <p id="join-error" class="error"></p>
</div>

<div id="session-card" class="card hidden">
  <div><strong id="game-title"></strong></div>
  <div class="status muted">経過 <span id="elapsed">--:--</span> / クロック補正 <span id="offset">--</span> ms</div>
  <div class="status muted">状態: <span id="session-status">recording</span></div>
</div>

<div id="marker-card" class="card hidden">
  <p class="muted">感じた瞬間にタップ (タイムラインに記録されます)</p>
  <div class="stamps">
    <button id="stamp-hype">盛り上がり</button>
    <button id="stamp-like">スキ</button>
    <button id="stamp-dislike">嫌い</button>
    <button id="stamp-stress">ストレス</button>
  </div>
  <p id="marker-error" class="error"></p>
</div>

<div id="audio-card" class="card hidden">
  <p class="muted" id="audio-support"></p>
  <button id="record" class="hidden">音声キャプチャを開始</button>
  <p id="audio-status" class="muted"></p>
  <p id="audio-error" class="error"></p>
</div>

<div class="card">
  <p class="muted">アイトラッキングは iPhone のネイティブコンパニオン (ARKit) が
  この端末と同じ接続先の <code>/api/gaze</code> へ送信します。このページからは送信されません。</p>
</div>

<script nonce="__COMPANION_SCRIPT_NONCE__">
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  let token = null;
  let clockOffsetMs = null; // sessionMs = performance.now() + clockOffsetMs
  let recorder = null;
  let recordedChunks = [];
  let recordingStartedAtMs = null;
  let syncTimer = null;
  let stopped = false;

  const api = async (path, options = {}) => {
    const response = await fetch(path, {
      method: options.method || 'GET',
      headers: {
        ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: 'Bearer ' + token } : {}),
        ...(options.headers || {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : options.rawBody,
    });
    const payload = await response.json().catch(() => ({ ok: false, error: {} }));
    if (!response.ok || !payload.ok) {
      throw new Error((payload.error && payload.error.message) || ('HTTP ' + response.status));
    }
    return payload.data;
  };

  const syncClock = async () => {
    // NTP-lite: assume half the round trip each way and keep the best estimate.
    const sentAt = performance.now();
    const data = await api('/api/sync', { method: 'POST', body: { clientSentAtMs: Math.round(sentAt) } });
    const receivedAt = performance.now();
    const roundTrip = receivedAt - sentAt;
    clockOffsetMs = data.sessionMs + roundTrip / 2 - receivedAt;
    $('offset').textContent = String(Math.round(roundTrip));
  };

  const sessionMsNow = () => clockOffsetMs === null
    ? null
    : Math.max(Math.round(performance.now() + clockOffsetMs), 0);

  const setupAudio = () => {
    $('audio-card').classList.remove('hidden');
    if (!window.isSecureContext) {
      $('audio-support').textContent = 'このページは HTTP で開かれているため、iPhone のマイクは'
        + '使えません (secure context 必須)。音声キャプチャには HTTPS 設定 (VOLPUTAS_COMPANION_TLS_*)'
        + ' が必要です。マーカー記録はこのまま使えます。';
      return;
    }
    if (!navigator.mediaDevices || typeof MediaRecorder === 'undefined') {
      $('audio-support').textContent = 'このブラウザは録音 API に対応していません。';
      return;
    }
    $('audio-support').textContent = 'プレイ中の声を収録し、セッション終了時にアップロードします。';
    $('record').classList.remove('hidden');
  };

  const uploadAudio = async () => {
    if (recordedChunks.length === 0) return;
    const type = recorder && recorder.mimeType ? recorder.mimeType.split(';')[0] : 'audio/mp4';
    const blob = new Blob(recordedChunks, { type });
    $('audio-status').textContent = 'アップロード中… (' + Math.round(blob.size / 1024) + ' KB)';
    const response = await fetch('/api/audio', {
      method: 'PUT',
      headers: {
        'content-type': type,
        authorization: 'Bearer ' + token,
        ...(recordingStartedAtMs === null ? {} : {
          'x-audio-duration-seconds': String((performance.now() - recordingStartedAtMs) / 1000),
        }),
      },
      body: blob,
    });
    const payload = await response.json().catch(() => ({ ok: false, error: {} }));
    if (!response.ok || !payload.ok) {
      throw new Error((payload.error && payload.error.message) || 'アップロードに失敗しました');
    }
    $('audio-status').textContent = 'アップロード完了: ' + payload.data.fileName;
  };

  const pollSession = async () => {
    if (stopped) return;
    try {
      const state = await api('/api/session');
      $('session-status').textContent = state.status;
      if (state.sessionMs !== null) {
        const total = Math.round((state.sessionMs) / 1000);
        $('elapsed').textContent = Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
      }
      if (state.status !== 'recording') {
        stopped = true;
        if (syncTimer !== null) clearInterval(syncTimer);
        if (recorder && recorder.state === 'recording') {
          recorder.onstop = () => {
            recorder.stream.getTracks().forEach((track) => track.stop());
            uploadAudio().catch((e) => { $('audio-error').textContent = e.message; });
          };
          recorder.stop();
        }
        return;
      }
    } catch (error) {
      $('session-status').textContent = '接続エラー: ' + error.message;
    }
    setTimeout(pollSession, 3000);
  };

  $('join').addEventListener('click', async () => {
    $('join-error').textContent = '';
    try {
      const data = await api('/api/join', { method: 'POST', body: { code: $('code').value.trim() } });
      token = data.token;
      $('game-title').textContent = data.session.gameTitle;
      $('join-card').classList.add('hidden');
      $('session-card').classList.remove('hidden');
      $('marker-card').classList.remove('hidden');
      try {
        await syncClock();
      } catch (error) {
        // Markers can omit sessionMs and fall back to the server clock until a
        // later periodic sync succeeds.
        $('session-status').textContent = 'クロック同期エラー: ' + error.message;
      }
      setupAudio();
      pollSession();
      syncTimer = setInterval(() => {
        if (!stopped) {
          syncClock().catch((error) => {
            $('session-status').textContent = 'クロック同期エラー: ' + error.message;
          });
        }
      }, 30000);
    } catch (error) {
      $('join-error').textContent = error.message;
    }
  });

  for (const type of ['hype', 'like', 'dislike', 'stress']) {
    $('stamp-' + type).addEventListener('click', async () => {
      $('marker-error').textContent = '';
      try {
        await api('/api/markers', { method: 'POST', body: { type, sessionMs: sessionMsNow() } });
      } catch (error) {
        $('marker-error').textContent = error.message;
      }
    });
  }

  $('record').addEventListener('click', async () => {
    $('audio-error').textContent = '';
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recorder = new MediaRecorder(stream);
      recordedChunks = [];
      recordingStartedAtMs = performance.now();
      recorder.ondataavailable = (event) => { if (event.data.size > 0) recordedChunks.push(event.data); };
      recorder.start(10000);
      $('record').disabled = true;
      $('audio-status').textContent = '収録中… (セッション終了で自動アップロード)';
    } catch (error) {
      if (stream) stream.getTracks().forEach((track) => track.stop());
      $('audio-error').textContent = 'マイクを開始できません: ' + error.message;
    }
  });
})();
</script>
</body>
</html>
`;

module.exports = { COMPANION_PAGE_HTML };
