// Runs post-hoc gaze estimation over a face recording: plays the video (muted,
// accelerated) through a landmark detector, turns each frame into a feature
// vector, then fits/apply the calibration and streams the samples to the
// server as NDJSON (spec/feature/emotion-capture-companion.md §視線推定).
// The DOM/video plumbing lives here; all math is in gazeFeatures.js and
// gazeCalibration.js.
import { extractGazeFeatures } from './gazeFeatures.js';
import { estimateGaze } from './gazeCalibration.js';

export const GAZE_EXTRACTOR = 'mediapipe-face-landmarker+affine-calibration';
export const DEFAULT_TARGET_FPS = 15;
// MediaRecorder webm files play back fine at 4x; landmark detection stays
// under the frame budget on a GPU delegate.
export const DEFAULT_PLAYBACK_RATE = 4;

// Frames come at the recorder's rate; keep at most targetFps of them so an
// hour of face video does not become 100k landmark runs.
/** @implements SPEC-EMOTION-CAPTURE-COMPANION */
export function createFrameThrottle(targetFps) {
  const intervalMs = 1000 / targetFps;
  let nextAtMs = -Infinity;
  return (mediaTimeMs) => {
    if (mediaTimeMs < nextAtMs) return false;
    // Align to the fps grid so the kept rate does not drift below targetFps.
    nextAtMs = (Math.floor(mediaTimeMs / intervalMs) + 1) * intervalMs;
    return true;
  };
}

/** @implements SPEC-EMOTION-CAPTURE-COMPANION */
export function frameToSample(startSessionMs, mediaTimeMs, landmarks) {
  return {
    sessionMs: Math.round(startSessionMs + mediaTimeMs),
    features: landmarks ? extractGazeFeatures(landmarks) : null,
  };
}

// Waits for the video to be decodable; MediaRecorder output reports an
// Infinity duration, so readiness is the only reliable signal.
function abortError() {
  return new DOMException('視線解析を中止しました。', 'AbortError');
}

function waitForVideo(video, signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  if (video.readyState >= 2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onReady = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error('顔カメラ映像を再生できませんでした。')); };
    const onAbort = () => { cleanup(); reject(abortError()); };
    const cleanup = () => {
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
    };
    video.addEventListener('loadeddata', onReady);
    video.addEventListener('error', onError);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

// Plays the video and invokes onFrame(mediaTimeMs) per presented frame,
// resolving when playback ends. Uses requestVideoFrameCallback when
// available (frame-accurate) and falls back to timeupdate polling.
/** @implements SPEC-EMOTION-CAPTURE-COMPANION */
export function playThroughFrames(video, { playbackRate, onFrame, signal }) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (error) => {
      if (finished) return;
      finished = true;
      video.pause();
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error); else resolve();
    };
    const onEnded = () => finish();
    const onError = () => finish(new Error('顔カメラ映像の再生中にエラーが発生しました。'));
    const onAbort = () => finish(abortError());
    video.addEventListener('ended', onEnded);
    video.addEventListener('error', onError);
    signal?.addEventListener('abort', onAbort);
    if (signal?.aborted) {
      onAbort();
      return;
    }

    if (typeof video.requestVideoFrameCallback === 'function') {
      const step = (_now, metadata) => {
        if (finished) return;
        try {
          onFrame(metadata.mediaTime * 1000);
        } catch (error) {
          finish(error);
          return;
        }
        video.requestVideoFrameCallback(step);
      };
      video.requestVideoFrameCallback(step);
    } else {
      const poll = () => {
        if (finished) return;
        if (!video.paused) {
          try {
            onFrame(video.currentTime * 1000);
          } catch (error) {
            finish(error);
            return;
          }
        }
        requestAnimationFrame(poll);
      };
      requestAnimationFrame(poll);
    }
    video.playbackRate = playbackRate;
    video.muted = true;
    video.play().catch(finish);
  });
}

// Serializes samples for PUT /api/local/capture-sessions/:id/gaze.
/** @implements SPEC-EMOTION-CAPTURE-COMPANION */
export function toNdjson(samples) {
  return samples.map((sample) => JSON.stringify(sample)).join('\n') + (samples.length ? '\n' : '');
}

/** @implements SPEC-EMOTION-CAPTURE-COMPANION */
export function estimationHeaders({ calibrated, fitError, frameRate }) {
  const headers = {
    'content-type': 'application/x-ndjson',
    'x-gaze-extractor': GAZE_EXTRACTOR,
    'x-gaze-calibrated': calibrated ? 'true' : 'false',
    'x-gaze-frame-rate': String(frameRate),
  };
  if (fitError !== null && fitError !== undefined) headers['x-gaze-fit-error'] = String(fitError);
  return headers;
}

// Full pipeline. `landmarker` is the object returned by loadFaceLandmarker;
// `video` an HTMLVideoElement already pointed at the face recording.
/** @implements SPEC-EMOTION-CAPTURE-COMPANION */
export async function runGazeEstimation({
  video,
  landmarker,
  startSessionMs,
  calibrationPoints,
  durationMs = null,
  targetFps = DEFAULT_TARGET_FPS,
  playbackRate = DEFAULT_PLAYBACK_RATE,
  onProgress = () => {},
  signal,
}) {
  await waitForVideo(video, signal);
  const frames = [];
  const shouldProcess = createFrameThrottle(targetFps);
  let lastMediaTimeMs = -1;
  await playThroughFrames(video, {
    playbackRate,
    signal,
    onFrame: (mediaTimeMs) => {
      // Timestamps must be monotonic for the VIDEO running mode.
      if (mediaTimeMs <= lastMediaTimeMs || !shouldProcess(mediaTimeMs)) return;
      lastMediaTimeMs = mediaTimeMs;
      const landmarks = landmarker.detect(video, Math.round(mediaTimeMs));
      frames.push(frameToSample(startSessionMs, mediaTimeMs, landmarks));
      if (durationMs) onProgress(Math.min(mediaTimeMs / durationMs, 1));
    },
  });
  onProgress(1);
  const estimate = estimateGaze(frames, calibrationPoints);
  return {
    ...estimate,
    frameCount: frames.length,
    detectedCount: frames.filter((frame) => frame.features).length,
    frameRate: targetFps,
  };
}
