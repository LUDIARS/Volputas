// Gaze overlay helpers for the capture replay
// (spec/feature/emotion-capture-companion.md §リプレイ): picking the samples
// around the playhead is pure and tested; drawing takes a canvas context.
export const DEFAULT_TRAIL_MS = 600;

// Samples are sorted by sessionMs (the log is append-only in time order; the
// post-hoc estimator emits in media order). Binary search keeps 30 Hz overlay
// updates cheap over an hour of samples.
export function lowerBound(samples, sessionMs) {
  let low = 0;
  let high = samples.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (samples[middle].sessionMs < sessionMs) low = middle + 1; else high = middle;
  }
  return low;
}

export function samplesAround(samples, sessionMs, trailMs = DEFAULT_TRAIL_MS) {
  if (!Array.isArray(samples) || samples.length === 0) return [];
  const start = lowerBound(samples, sessionMs - trailMs);
  const end = lowerBound(samples, sessionMs + 1);
  return samples.slice(start, end);
}

// Converts sessionMs ↔ media time for a recording placed on the session clock.
export function sessionMsToMediaSeconds(recording, sessionMs) {
  return Math.max((sessionMs - recording.startSessionMs) / 1000, 0);
}

export function mediaSecondsToSessionMs(recording, seconds) {
  return recording.startSessionMs + seconds * 1000;
}

// Draws the trail (fading dots) and the current fixation on a canvas whose
// pixel size matches the video's displayed size. Off-screen samples (outside
// 0..1) are drawn clamped to the edge in a different colour so "looked away"
// stays visible.
export function drawGazeOverlay(context, samples, width, height, { nowMs } = {}) {
  context.clearRect(0, 0, width, height);
  if (samples.length === 0) return;
  const last = samples[samples.length - 1];
  const span = Math.max(nowMs - samples[0].sessionMs, 1);
  for (const sample of samples) {
    if (!sample.valid) continue;
    const age = (nowMs - sample.sessionMs) / span;
    const onScreen = sample.x >= 0 && sample.x <= 1 && sample.y >= 0 && sample.y <= 1;
    const px = Math.min(Math.max(sample.x, 0), 1) * width;
    const py = Math.min(Math.max(sample.y, 0), 1) * height;
    context.beginPath();
    context.arc(px, py, sample === last ? 14 : 6, 0, Math.PI * 2);
    context.fillStyle = onScreen
      ? `rgba(255, 96, 64, ${(0.15 + (1 - age) * 0.5).toFixed(3)})`
      : `rgba(120, 120, 120, ${(0.15 + (1 - age) * 0.4).toFixed(3)})`;
    context.fill();
  }
  if (last.valid) {
    const px = Math.min(Math.max(last.x, 0), 1) * width;
    const py = Math.min(Math.max(last.y, 0), 1) * height;
    context.beginPath();
    context.arc(px, py, 18, 0, Math.PI * 2);
    context.strokeStyle = 'rgba(255, 96, 64, 0.9)';
    context.lineWidth = 2;
    context.stroke();
  }
}
