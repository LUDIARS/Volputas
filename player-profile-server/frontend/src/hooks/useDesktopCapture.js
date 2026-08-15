import { useCallback, useEffect, useRef, useState } from 'react';
import { localPutRaw } from '../lib/localApi';
import {
  AUDIO_MAX_BYTES,
  AUDIO_MIME_CANDIDATES,
  TrackRecorder,
  VIDEO_MAX_BYTES,
  VIDEO_MIME_CANDIDATES,
  assertBlobWithinLimit,
  audioHeaders,
  pickMimeType,
  recordingHeaders,
  sessionClockMs,
} from '../lib/captureRecording';

// Desktop capture for the active session (spec/feature/emotion-capture-companion.md
// §デスクトップキャプチャ): the face camera + microphone and the game screen are
// recorded in this browser tab and uploaded once the session has stopped.
// Recording start/stop is stamped on the session clock so the server can
// replay every stream against gaze, markers and speech.
const BASE = '/api/local/capture-sessions';

const IDLE = { status: 'idle', error: '', startSessionMs: null };

function stopStream(stream) {
  stream?.getTracks().forEach((track) => track.stop());
}

/** @implements SPEC-EMOTION-CAPTURE-COMPANION */
export function useDesktopCapture({ active, onUploaded, onError }) {
  const [face, setFace] = useState(IDLE);
  const [screen, setScreen] = useState(IDLE);
  const [faceStream, setFaceStream] = useState(null);
  const [uploading, setUploading] = useState(false);
  // Recorders and the session they belong to live in refs: they must survive
  // re-renders and be reachable from the effect that reacts to the session
  // ending under our feet (game-signalled stop).
  const recorders = useRef({ face: null, audio: null, screen: null });
  const streams = useRef({ face: null, screen: null });
  const session = useRef(null); // { id, startedAt }
  // Frame sizes are read at start; the tracks are gone by upload time.
  const frameSizes = useRef({ face: {}, screen: {} });
  const activeRef = useRef(active);
  activeRef.current = active;

  const clock = useCallback(() => (session.current ? sessionClockMs(session.current.startedAt) : 0), []);

  const bindSession = useCallback(() => {
    if (!activeRef.current) throw new Error('キャプチャセッションが進行中ではありません。');
    if (!session.current || session.current.id !== activeRef.current.id) {
      session.current = { id: activeRef.current.id, startedAt: activeRef.current.startedAt };
    }
  }, []);

  const startFace = useCallback(async () => {
    let stream = null;
    let videoRecorder = null;
    let audioRecorder = null;
    setFace({ ...IDLE, status: 'starting' });
    try {
      bindSession();
      const targetSessionId = session.current.id;
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 }, facingMode: 'user' },
        audio: true,
      });
      streams.current.face = stream;
      frameSizes.current.face = stream.getVideoTracks()[0]?.getSettings?.() || {};
      setFaceStream(stream);
      videoRecorder = new TrackRecorder({
        stream,
        mimeType: pickMimeType(VIDEO_MIME_CANDIDATES, globalThis.MediaRecorder),
        sessionClock: clock,
      });
      const audioTracks = stream.getAudioTracks();
      audioRecorder = audioTracks.length > 0
        ? new TrackRecorder({
          stream: new MediaStream(audioTracks),
          mimeType: pickMimeType(AUDIO_MIME_CANDIDATES, globalThis.MediaRecorder),
          sessionClock: clock,
        })
        : null;
      recorders.current.face = videoRecorder;
      recorders.current.audio = audioRecorder;
      const startSessionMs = await videoRecorder.start();
      if (activeRef.current?.id !== targetSessionId) {
        throw new Error('キャプチャセッションが録画開始前に終了しました。');
      }
      if (audioRecorder) await audioRecorder.start();
      if (activeRef.current?.id !== targetSessionId) {
        throw new Error('キャプチャセッションが録画開始前に終了しました。');
      }
      setFace({ status: 'recording', error: '', startSessionMs });
    } catch (reason) {
      await Promise.allSettled([audioRecorder?.stop(), videoRecorder?.stop()].filter(Boolean));
      if (recorders.current.face === videoRecorder) recorders.current.face = null;
      if (recorders.current.audio === audioRecorder) recorders.current.audio = null;
      stopStream(stream);
      streams.current.face = null;
      setFaceStream(null);
      setFace({ ...IDLE, status: 'error', error: reason.message });
      onError?.(reason.message);
    }
  }, [bindSession, clock, onError]);

  const startScreen = useCallback(async () => {
    let stream = null;
    let recorder = null;
    setScreen({ ...IDLE, status: 'starting' });
    try {
      bindSession();
      const targetSessionId = session.current.id;
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30 } },
        audio: true,
      });
      streams.current.screen = stream;
      frameSizes.current.screen = stream.getVideoTracks()[0]?.getSettings?.() || {};
      recorder = new TrackRecorder({
        stream,
        mimeType: pickMimeType(VIDEO_MIME_CANDIDATES, globalThis.MediaRecorder),
        sessionClock: clock,
      });
      recorders.current.screen = recorder;
      const startSessionMs = await recorder.start();
      if (activeRef.current?.id !== targetSessionId) {
        throw new Error('キャプチャセッションが録画開始前に終了しました。');
      }
      setScreen({ status: 'recording', error: '', startSessionMs });
      // "Stop sharing" in the browser chrome ends the track; treat it as stop.
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        recorder.stop().catch((reason) => {
          setScreen({ ...IDLE, status: 'error', error: reason.message });
          onError?.(reason.message);
        });
        setScreen((current) => (current.status === 'recording' ? { ...current, status: 'stopped' } : current));
      });
    } catch (reason) {
      // Preserve the acquisition error; recorder cleanup is best-effort.
      await recorder?.stop().catch(() => undefined);
      if (recorders.current.screen === recorder) recorders.current.screen = null;
      stopStream(stream);
      streams.current.screen = null;
      setScreen({ ...IDLE, status: 'error', error: reason.message });
      onError?.(reason.message);
    }
  }, [bindSession, clock, onError]);

  // Stops every recorder (keeping their results) without uploading. Called
  // before the session stop request so the recordings end on the session clock
  // and before the server closes the clock.
  const stopRecorders = useCallback(async () => {
    const results = {};
    const entries = ['face', 'audio', 'screen']
      .map((key) => [key, recorders.current[key]])
      .filter(([, recorder]) => Boolean(recorder));
    // Transfer ownership to this stop operation immediately. A later session
    // may create new recorders while these results are uploading; completion
    // of the old upload must never clear those new references.
    recorders.current = { face: null, audio: null, screen: null };
    if (entries.length > 0) setUploading(true);
    const settled = await Promise.allSettled(entries.map(([, recorder]) => recorder.stop()));
    const stopErrors = [];
    settled.forEach((outcome, index) => {
      const [key] = entries[index];
      if (outcome.status === 'fulfilled') results[key] = outcome.value;
      else stopErrors.push(`${key}: ${outcome.reason?.message || '録画停止エラー'}`);
    });
    if (stopErrors.length > 0) {
      onError?.(`一部の録画を正常に停止できませんでした (${stopErrors.join(' / ')})`);
    }
    stopStream(streams.current.face);
    stopStream(streams.current.screen);
    streams.current = { face: null, screen: null };
    setFaceStream(null);
    setFace((current) => (current.status === 'recording' ? { ...current, status: 'stopped' } : current));
    setScreen((current) => (current.status === 'recording' ? { ...current, status: 'stopped' } : current));
    return results;
  }, [onError]);

  const uploadRecordings = useCallback(async (results, target) => {
    if (!target) {
      setUploading(false);
      return;
    }
    const uploaded = [];
    const errors = [];
    try {
      const { face: faceResult, audio: audioResult, screen: screenResult } = results;
      const ownsTarget = () => session.current?.id === target.id;
      const size = (kind) => ({
        width: frameSizes.current[kind].width,
        height: frameSizes.current[kind].height,
      });
      const attempt = async (label, operation, onFailure = () => {}) => {
        try {
          await operation();
          uploaded.push(label);
        } catch (reason) {
          onFailure(reason);
          errors.push(`${label}: ${reason.message}`);
        }
      };
      if (audioResult && audioResult.blob.size > 0) await attempt('audio', async () => {
        assertBlobWithinLimit(audioResult.blob, AUDIO_MAX_BYTES, '音声');
        await localPutRaw(`${BASE}/${target.id}/audio`, audioResult.blob, audioHeaders(audioResult));
      });
      if (faceResult && faceResult.blob.size > 0) {
        if (ownsTarget()) setFace((current) => ({ ...current, status: 'uploading' }));
        await attempt('face', async () => {
          assertBlobWithinLimit(faceResult.blob, VIDEO_MAX_BYTES, '顔カメラ映像');
          await localPutRaw(
            `${BASE}/${target.id}/recordings/face`,
            faceResult.blob,
            recordingHeaders({ ...faceResult, ...size('face') })
          );
          if (ownsTarget()) setFace((current) => ({ ...current, status: 'uploaded' }));
        }, (reason) => {
          if (ownsTarget()) setFace((current) => ({ ...current, status: 'error', error: reason.message }));
        });
      }
      if (screenResult && screenResult.blob.size > 0) {
        if (ownsTarget()) setScreen((current) => ({ ...current, status: 'uploading' }));
        await attempt('screen', async () => {
          assertBlobWithinLimit(screenResult.blob, VIDEO_MAX_BYTES, '画面録画');
          await localPutRaw(
            `${BASE}/${target.id}/recordings/screen`,
            screenResult.blob,
            recordingHeaders({ ...screenResult, ...size('screen') })
          );
          if (ownsTarget()) setScreen((current) => ({ ...current, status: 'uploaded' }));
        }, (reason) => {
          if (ownsTarget()) setScreen((current) => ({ ...current, status: 'error', error: reason.message }));
        });
      }
      onUploaded?.({ sessionId: target.id, uploaded });
      if (errors.length > 0) onError?.(`一部の録画をアップロードできませんでした (${errors.join(' / ')})`);
    } finally {
      setUploading(false);
    }
  }, [onUploaded, onError]);

  // Stop-and-upload for the explicit "セッション終了" button: the caller stops
  // the session between the two steps.
  const finish = useCallback(async (stopSession) => {
    const target = session.current;
    const results = await stopRecorders();
    try {
      await stopSession();
    } catch (reason) {
      setUploading(false);
      throw reason;
    }
    await uploadRecordings(results, target);
  }, [stopRecorders, uploadRecordings]);

  // The game (or another client) may stop the session; when the active session
  // disappears while we are still recording, stop and upload to the session we
  // were bound to.
  useEffect(() => {
    if (active || !session.current) return;
    const hasRecorders = Object.values(recorders.current).some(Boolean);
    if (!hasRecorders) return;
    const target = session.current;
    stopRecorders()
      .then((results) => uploadRecordings(results, target))
      .catch((reason) => {
        setUploading(false);
        onError?.(reason.message);
      });
  }, [active, stopRecorders, uploadRecordings, onError]);

  useEffect(() => () => {
    stopStream(streams.current.face);
    stopStream(streams.current.screen);
  }, []);

  const reset = useCallback(() => {
    session.current = null;
    setFace(IDLE);
    setScreen(IDLE);
  }, []);

  return {
    face,
    screen,
    faceStream,
    uploading,
    starting: face.status === 'starting' || screen.status === 'starting',
    recording: face.status === 'recording' || screen.status === 'recording',
    startFace,
    startScreen,
    finish,
    reset,
    sessionClock: clock,
  };
}
