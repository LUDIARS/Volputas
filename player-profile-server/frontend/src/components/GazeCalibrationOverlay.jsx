import { useEffect, useRef, useState } from 'react';

// Full-screen calibration for post-hoc gaze estimation
// (spec/feature/emotion-capture-companion.md §視線推定): while the face camera
// records, targets appear one after another; the player looks at each and the
// session-clock window of every dwell is reported back. Nothing is estimated
// here — the windows are matched against the face video afterwards.
export const CALIBRATION_TARGETS = [
  [0.1, 0.1], [0.5, 0.1], [0.9, 0.1],
  [0.1, 0.5], [0.5, 0.5], [0.9, 0.5],
  [0.1, 0.9], [0.5, 0.9], [0.9, 0.9],
];
// Settle lets the eyes arrive before the dwell window opens; only the dwell is
// used for fitting.
export const SETTLE_MS = 700;
export const DWELL_MS = 1300;

/** @implements SPEC-EMOTION-CAPTURE-COMPANION */
export default function GazeCalibrationOverlay({ sessionClock, onComplete, onCancel }) {
  const [index, setIndex] = useState(-1);
  const [phase, setPhase] = useState('intro'); // intro | settle | dwell | done
  const points = useRef([]);
  const timers = useRef([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  function schedule(fn, delay) {
    timers.current.push(setTimeout(fn, delay));
  }

  function runTarget(targetIndex) {
    if (targetIndex >= CALIBRATION_TARGETS.length) {
      setPhase('done');
      onComplete({
        points: points.current,
        screen: { width: window.screen?.width, height: window.screen?.height },
      });
      return;
    }
    setIndex(targetIndex);
    setPhase('settle');
    schedule(() => {
      const fromSessionMs = sessionClock();
      setPhase('dwell');
      schedule(() => {
        const [x, y] = CALIBRATION_TARGETS[targetIndex];
        points.current.push({ x, y, fromSessionMs, toSessionMs: sessionClock() });
        runTarget(targetIndex + 1);
      }, DWELL_MS);
    }, SETTLE_MS);
  }

  function start() {
    points.current = [];
    const root = document.documentElement;
    if (root.requestFullscreen && !document.fullscreenElement) {
      root.requestFullscreen().catch(() => {});
    }
    runTarget(0);
  }

  function cancel() {
    timers.current.forEach(clearTimeout);
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    onCancel();
  }

  useEffect(() => {
    if (phase === 'done' && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }, [phase]);

  const target = index >= 0 ? CALIBRATION_TARGETS[index] : null;
  return (
    <div className="gaze-calibration-overlay" role="dialog" aria-label="視線キャリブレーション">
      {phase === 'intro' && (
        <div className="gaze-calibration-intro">
          <h3>視線キャリブレーション</h3>
          <p>
            顔カメラを見える位置に置いたまま、順番に表示される {CALIBRATION_TARGETS.length} 個の点を
            頭を動かさずに目で追ってください (約 {Math.round(CALIBRATION_TARGETS.length * (SETTLE_MS + DWELL_MS) / 1000)} 秒)。
            画面全体を使うため全画面表示に切り替わります。
          </p>
          <div className="capture-active-actions">
            <button type="button" onClick={start}>開始</button>
            <button type="button" className="btn-outline" onClick={cancel}>キャンセル</button>
          </div>
        </div>
      )}
      {target && phase !== 'done' && (
        <div
          className={`gaze-calibration-target gaze-calibration-${phase}`}
          style={{ left: `${target[0] * 100}%`, top: `${target[1] * 100}%` }}
        >
          <span>{index + 1}</span>
        </div>
      )}
      {phase !== 'intro' && (
        <button type="button" className="gaze-calibration-cancel btn-outline" onClick={cancel}>中止</button>
      )}
    </div>
  );
}
