import { useEffect, useRef, useState } from 'react';
import { localPutRaw } from '../lib/localApi';
import { loadFaceLandmarker } from '../lib/gaze/faceLandmarkerAdapter';
import {
  estimationHeaders,
  runGazeEstimation,
  toNdjson,
} from '../lib/gaze/gazeEstimationRunner';

// Post-hoc gaze estimation for one completed session
// (spec/feature/emotion-capture-companion.md §視線推定): runs the face
// recording through the local landmark model in this browser, fits the saved
// calibration, and replaces the session's gaze log. Everything stays on the
// machine; the button reports exactly which mode (calibrated or heuristic)
// produced the samples.
const BASE = '/api/local/capture-sessions';

/** @implements SPEC-EMOTION-CAPTURE-COMPANION */
export default function GazeAnalysisControl({ record, onDone, onError }) {
  const videoRef = useRef(null);
  const abortRef = useRef(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('');
  const face = record.capture?.faceRecording;
  const calibrationPoints = record.calibration?.points || null;

  useEffect(() => () => abortRef.current?.abort(), []);

  async function run() {
    if (!face) return;
    setRunning(true);
    setProgress(0);
    setStage('モデルを読み込み中…');
    const controller = new AbortController();
    abortRef.current = controller;
    let landmarker = null;
    try {
      landmarker = await loadFaceLandmarker();
      setStage('顔カメラ映像を解析中…');
      const video = videoRef.current;
      video.src = `${BASE}/${record.id}/recordings/face`;
      const result = await runGazeEstimation({
        video,
        landmarker,
        startSessionMs: face.startSessionMs,
        calibrationPoints,
        durationMs: Number.isFinite(face.durationSeconds) ? face.durationSeconds * 1000 : null,
        onProgress: setProgress,
        signal: controller.signal,
      });
      setStage('サーバへ保存中…');
      await localPutRaw(
        `${BASE}/${record.id}/gaze`,
        toNdjson(result.samples),
        estimationHeaders(result)
      );
      onDone(
        `視線を推定しました: ${result.samples.length} sample (顔検出 ${result.detectedCount}/${result.frameCount} フレーム, `
        + `${result.calibrated ? `キャリブレーション適用・誤差 ${result.fitError}` : 'キャリブレーション無し (粗い推定)'})。`
      );
    } catch (reason) {
      if (reason?.name !== 'AbortError') onError(reason.message);
    } finally {
      landmarker?.close?.();
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.removeAttribute('src');
        videoRef.current.load();
      }
      setRunning(false);
      setStage('');
      abortRef.current = null;
    }
  }

  if (!face) return null;
  return (
    <span className="gaze-analysis-control">
      <button type="button" disabled={running} onClick={run}>
        {running ? `${stage} ${Math.round(progress * 100)}%` : record.gazeEstimation ? '視線を再解析' : '視線を解析'}
      </button>
      {running && (
        <button type="button" className="btn-outline" onClick={() => abortRef.current?.abort()}>中止</button>
      )}
      {!calibrationPoints && !running && (
        <span className="capture-record-meta"> キャリブレーション無し: 粗い推定になります</span>
      )}
      <video ref={videoRef} className="gaze-analysis-video" muted playsInline preload="auto" />
    </span>
  );
}
