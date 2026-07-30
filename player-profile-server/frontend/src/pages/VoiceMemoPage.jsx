import { useEffect, useRef, useState } from 'react';
import ProfileFeatureLayout from '../components/ProfileFeatureLayout';
import ProfileField from '../components/ProfileField';
import ProfileMedia from '../components/ProfileMedia';
import { useProfileClient } from '../lib/profileClient';
import {
  preferredVoiceMemoMimeType,
  validateVoiceMemoBlob,
  voiceMemoExtension,
} from '../lib/voiceMemoRecording';

const INITIAL_FORM = {
  gameTitle: '',
  transcript: '',
  sentiment: '0',
};

const SENTIMENTS = {
  '-2': '強い不満',
  '-1': 'やや不満',
  0: '中立',
  1: 'やや好意的',
  2: '強い好意的',
};

export default function VoiceMemoPage() {
  const client = useProfileClient();
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const startedAtRef = useRef(0);
  const [form, setForm] = useState(INITIAL_FORM);
  const [recording, setRecording] = useState(false);
  const [recorded, setRecorded] = useState(null);
  const [records, setRecords] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    client.list('voice-memos').then(setRecords).catch((reason) => setError(reason.message));
  }, [client]);

  useEffect(() => () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  function update(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      throw new Error('このブラウザは音声録音に対応していません。');
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = preferredVoiceMemoMimeType(window.MediaRecorder);
    const recorder = mimeType
      ? new window.MediaRecorder(stream, { mimeType })
      : new window.MediaRecorder(stream);
    chunksRef.current = [];
    streamRef.current = stream;
    recorderRef.current = recorder;
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    });
    recorder.addEventListener('stop', () => {
      const type = recorder.mimeType || mimeType || 'audio/webm';
      const blob = new Blob(chunksRef.current, { type });
      const durationSeconds = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      try {
        validateVoiceMemoBlob(blob);
        setRecorded({
          blob,
          durationSeconds,
          fileName: `voice-memo-${Date.now()}.${voiceMemoExtension(type)}`,
          previewUrl: URL.createObjectURL(blob),
        });
      } catch (reason) {
        setError(reason.message);
      }
    }, { once: true });
    startedAtRef.current = Date.now();
    recorder.start();
    setRecording(true);
  }

  function stopRecording() {
    recorderRef.current?.stop();
    setRecording(false);
  }

  async function toggleRecording() {
    setError('');
    setSuccess('');
    if (recording) {
      stopRecording();
      return;
    }
    if (recorded?.previewUrl) URL.revokeObjectURL(recorded.previewUrl);
    setRecorded(null);
    try {
      await startRecording();
    } catch (reason) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setError(reason.message);
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (!recorded) {
      setError('先に音声を録音してください。');
      return;
    }
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const result = await client.create('voice-memos', {
        ...form,
        audioFileName: recorded.fileName,
        durationSeconds: recorded.durationSeconds,
      });
      await client.upload('voice-memos', result.record.id, recorded.blob);
      setRecords((current) => [result.record, ...current]);
      URL.revokeObjectURL(recorded.previewUrl);
      setRecorded(null);
      setForm(INITIAL_FORM);
      setSuccess(form.transcript.trim()
        ? '音声メモと文字起こしを保存しました。'
        : '音声メモを保存しました。文字起こしを追加するまで分析証拠には使われません。');
    } catch (reason) {
      setError(reason.message);
    } finally {
      setSaving(false);
    }
  }

  const entryForm = (
    <form onSubmit={submit}>
      <h3>プレイ後の声を残す</h3>
      <p className="form-intro">
        録音ボタンを押して感想を話してください。文字起こしだけがペルソナ分析に使われます。
      </p>
      <ProfileField label="ゲーム名">
        <input name="gameTitle" value={form.gameTitle} onChange={update} required />
      </ProfileField>
      <button
        type="button"
        className={`voice-record-button ${recording ? 'voice-recording' : ''}`}
        onClick={toggleRecording}
        aria-pressed={recording}
      >
        {recording ? '■ 録音を終了' : '● 録音を開始'}
      </button>
      {recorded && (
        <div className="voice-recording-preview">
          <audio controls src={recorded.previewUrl} />
          <span>{recorded.durationSeconds} 秒</span>
        </div>
      )}
      <ProfileField label="文字起こし（任意）" hint="空のまま保存した録音は分析証拠に含まれません。">
        <textarea
          name="transcript"
          rows="6"
          value={form.transcript}
          onChange={update}
          placeholder="録音した内容を貼り付けるか入力してください"
        />
      </ProfileField>
      <ProfileField label="感情">
        <select name="sentiment" value={form.sentiment} onChange={update}>
          {Object.entries(SENTIMENTS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </ProfileField>
      <button className="btn-primary" disabled={saving || recording}>
        {saving ? '保存中…' : '音声メモを保存'}
      </button>
    </form>
  );

  return (
    <ProfileFeatureLayout
      title="ボイスメモ"
      description="プレイ直後の感想を音声で残し、手動の文字起こしをペルソナ分析へ接続します。"
      form={entryForm}
      records={records}
      error={error}
      success={success}
      emptyMessage="保存された音声メモはまだありません。"
      renderRecord={(record) => (
        <article className="card profile-record" key={record.id}>
          <div className="record-heading">
            <div>
              <h4>{record.gameTitle}</h4>
              <span>{record.durationSeconds || 0} 秒</span>
            </div>
            <span className={`sentiment sentiment-${record.sentiment}`}>
              {SENTIMENTS[record.sentiment]}
            </span>
          </div>
          <ProfileMedia
            as="audio"
            controls
            className="voice-memo-audio"
            kind="voice-memos"
            recordId={record.id}
          />
          {record.transcript
            ? <p className="record-comment">{record.transcript}</p>
            : <p className="record-comment voice-transcript-pending">文字起こし待ち（分析対象外）</p>}
        </article>
      )}
    />
  );
}
