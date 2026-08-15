import { useState } from 'react';
import { localPutRaw } from '../lib/localApi';
import {
  AUDIO_MAX_BYTES,
  VIDEO_MAX_BYTES,
  assertBlobWithinLimit,
  audioHeaders,
  baseMimeType,
  recordingHeaders,
} from '../lib/captureRecording';

// After-the-fact upload of recordings made outside the browser (OBS, console
// capture, a phone) for a completed session
// (spec/feature/emotion-capture-companion.md §録画). The player states where
// the file starts on the session clock; the server refuses to guess.
const BASE = '/api/local/capture-sessions';

const KINDS = [
  { id: 'screen', label: 'ゲーム画面録画', accept: 'video/mp4,video/webm,video/quicktime,video/x-matroska,.mkv' },
  { id: 'face', label: '顔カメラ映像', accept: 'video/mp4,video/webm,video/quicktime,video/x-matroska,.mkv' },
  { id: 'audio', label: '音声のみ', accept: 'audio/webm,audio/ogg,audio/mp4,audio/mpeg,audio/wav' },
];

// Browsers leave .mkv with an empty type; the store keys on the MIME type.
function inferContentType(file) {
  const type = baseMimeType(file.type);
  if (type) return type;
  const extension = file.name.split('.').pop().toLowerCase();
  return {
    mkv: 'video/x-matroska', webm: 'video/webm', mp4: 'video/mp4', mov: 'video/quicktime',
    m4a: 'audio/mp4', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
  }[extension] || '';
}

/** @implements SPEC-EMOTION-CAPTURE-COMPANION */
export default function CaptureRecordingUpload({ record, onUploaded, onError }) {
  const [kind, setKind] = useState('screen');
  const [file, setFile] = useState(null);
  const [startSeconds, setStartSeconds] = useState('0');
  const [busy, setBusy] = useState(false);
  const selected = KINDS.find((entry) => entry.id === kind);

  async function upload(event) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    try {
      const contentType = inferContentType(file);
      if (!contentType) throw new Error('ファイル形式を判定できませんでした。');
      const startSessionMs = Math.round(Number(startSeconds || 0) * 1000);
      if (kind === 'audio') {
        assertBlobWithinLimit(file, AUDIO_MAX_BYTES, '音声');
        await localPutRaw(`${BASE}/${record.id}/audio`, file, audioHeaders({ contentType, startSessionMs, durationSeconds: null }));
      } else {
        assertBlobWithinLimit(file, VIDEO_MAX_BYTES, '録画');
        await localPutRaw(
          `${BASE}/${record.id}/recordings/${kind}`,
          file,
          recordingHeaders({ contentType, startSessionMs, durationSeconds: null })
        );
      }
      setFile(null);
      event.target.reset?.();
      onUploaded(`${selected.label}をアップロードしました。`);
    } catch (reason) {
      onError(reason.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="capture-upload-form" onSubmit={upload}>
      <strong>録画ファイルを追加</strong>
      <select aria-label="録画の種類" value={kind} onChange={(event) => setKind(event.target.value)}>
        {KINDS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
      </select>
      <input
        type="file"
        aria-label="録画ファイル"
        accept={selected.accept}
        onChange={(event) => setFile(event.target.files[0] || null)}
      />
      <label className="capture-upload-offset">
        セッション開始からのずれ (秒)
        <input
          type="number"
          min="0"
          step="0.1"
          value={startSeconds}
          onChange={(event) => setStartSeconds(event.target.value)}
        />
      </label>
      <button type="submit" disabled={!file || busy}>{busy ? 'アップロード中…' : 'アップロード'}</button>
      {kind === 'audio' && record.capture?.audioFileName && (
        <span className="capture-record-meta">音声は 1 セッション 1 回のみです (既にあります)。</span>
      )}
    </form>
  );
}
