import { useCallback, useEffect, useRef, useState } from 'react';
import { localApi } from '../lib/localApi';
import CaptureTimelineView, { formatClock } from './CaptureTimelineView';
import {
  drawGazeOverlay,
  mediaSecondsToSessionMs,
  samplesAround,
  sessionMsToMediaSeconds,
} from '../lib/gazeOverlay';

// Synchronized replay of one capture session
// (spec/feature/emotion-capture-companion.md §リプレイ): the game-screen
// recording with the player's gaze drawn on top, the face camera as a small
// inset, and the timeline/markers/utterances all seeking the same session
// clock. Sessions without a screen recording still get the timeline and the
// utterance list.
const BASE = '/api/local/capture-sessions';

/** @implements SPEC-EMOTION-CAPTURE-COMPANION */
export default function CaptureReplayView({ record, timeline }) {
  const screenRef = useRef(null);
  const faceRef = useRef(null);
  const canvasRef = useRef(null);
  const [gazeSamples, setGazeSamples] = useState(null);
  const [playheadMs, setPlayheadMs] = useState(0);
  // Mirror of playheadMs for the animation loop, so the loop's callbacks do
  // not have to be re-created (and the loop restarted) on every frame.
  const playheadRef = useRef(0);
  const [error, setError] = useState('');
  const { media } = timeline;
  const hasScreen = Boolean(media?.screen);
  const hasFace = Boolean(media?.face);
  const hasGaze = (record.capture?.gazeSampleCount || 0) > 0;

  useEffect(() => {
    if (!hasGaze) return;
    localApi(`${BASE}/${record.id}/gaze`)
      .then((samples) => setGazeSamples([...samples].sort((left, right) => left.sessionMs - right.sessionMs)))
      .catch((reason) => setError(reason.message));
  }, [record.id, hasGaze]);

  const currentSessionMs = useCallback(() => {
    if (hasScreen && screenRef.current) {
      return mediaSecondsToSessionMs(media.screen, screenRef.current.currentTime);
    }
    if (hasFace && faceRef.current) {
      return mediaSecondsToSessionMs(media.face, faceRef.current.currentTime);
    }
    return playheadRef.current;
  }, [hasScreen, hasFace, media]);

  // The screen video is the master clock; the face inset follows it.
  const syncFace = useCallback((sessionMs) => {
    if (!hasFace || !faceRef.current || !hasScreen) return;
    const target = sessionMsToMediaSeconds(media.face, sessionMs);
    if (Math.abs(faceRef.current.currentTime - target) > 0.35) faceRef.current.currentTime = target;
  }, [hasFace, hasScreen, media]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const video = screenRef.current;
    if (!canvas || !video) return;
    const width = video.clientWidth;
    const height = video.clientHeight;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const nowMs = currentSessionMs();
    const context = canvas.getContext('2d');
    drawGazeOverlay(context, gazeSamples ? samplesAround(gazeSamples, nowMs) : [], width, height, { nowMs });
  }, [currentSessionMs, gazeSamples]);

  useEffect(() => {
    if (!hasScreen && !hasFace) return undefined;
    let frame;
    const tick = () => {
      const sessionMs = currentSessionMs();
      if (Math.abs(sessionMs - playheadRef.current) >= 50) {
        playheadRef.current = sessionMs;
        setPlayheadMs(sessionMs);
      }
      draw();
      syncFace(sessionMs);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [hasScreen, hasFace, currentSessionMs, draw, syncFace]);

  function seek(sessionMs) {
    if (hasScreen && screenRef.current) {
      screenRef.current.currentTime = sessionMsToMediaSeconds(media.screen, sessionMs);
    } else if (hasFace && faceRef.current) {
      faceRef.current.currentTime = sessionMsToMediaSeconds(media.face, sessionMs);
    }
    playheadRef.current = sessionMs;
    setPlayheadMs(sessionMs);
    syncFace(sessionMs);
  }

  function togglePlay() {
    const master = hasScreen ? screenRef.current : faceRef.current;
    if (!master) return;
    if (master.paused) {
      master.play().catch(() => {});
      if (hasScreen && hasFace) faceRef.current?.play().catch(() => {});
    } else {
      master.pause();
      if (hasScreen && hasFace) faceRef.current?.pause();
    }
  }

  const affect = timeline.affect || [];

  return (
    <div className="capture-replay">
      {error && <div className="error-message">{error}</div>}
      {(hasScreen || hasFace) && (
        <div className="capture-replay-stage">
          {hasScreen ? (
            <div className="capture-replay-screen">
              <video
                ref={screenRef}
                src={`${BASE}/${record.id}/recordings/screen`}
                controls
                preload="metadata"
                onPlay={() => hasFace && faceRef.current?.play().catch(() => {})}
                onPause={() => hasFace && faceRef.current?.pause()}
              />
              <canvas ref={canvasRef} className="capture-gaze-canvas" aria-hidden="true" />
            </div>
          ) : (
            <div className="capture-replay-screen">
              <video ref={faceRef} src={`${BASE}/${record.id}/recordings/face`} controls preload="metadata" />
            </div>
          )}
          {hasScreen && hasFace && (
            <video
              ref={faceRef}
              className="capture-face-inset"
              src={`${BASE}/${record.id}/recordings/face`}
              muted
              preload="metadata"
            />
          )}
        </div>
      )}
      <div className="capture-replay-controls">
        {(hasScreen || hasFace) && (
          <button type="button" onClick={togglePlay}>再生 / 一時停止</button>
        )}
        <span className="capture-record-meta">
          {formatClock(playheadMs)} / {formatClock(timeline.durationMs)}
          {hasGaze && gazeSamples ? ` ・ 視線 ${gazeSamples.length} sample (${timeline.gazeSource || 'companion'})` : ''}
          {hasScreen && !hasGaze ? ' ・ 視線データなし (顔カメラ映像から「視線を解析」で生成できます)' : ''}
        </span>
      </div>
      <CaptureTimelineView timeline={timeline} playheadMs={playheadMs} onSeek={seek} />
      {affect.length > 0 && (
        <ul className="capture-utterance-list">
          {affect.map((point, index) => (
            <li key={`${point.sessionMs}-${index}`}>
              <button type="button" className="capture-seek-link" onClick={() => seek(point.sessionMs)}>
                {formatClock(point.sessionMs)}
              </button>
              {' '}
              <span className={`capture-valence-${point.valence >= 1 ? 'positive' : point.valence <= -1 ? 'negative' : 'neutral'}`}>
                {point.valence > 0 ? `+${point.valence}` : point.valence}/覚醒{point.arousal}
              </span>
              {' '}{point.text}
            </li>
          ))}
        </ul>
      )}
      {!hasScreen && !hasFace && record.capture?.audioFileName && (
        <audio controls src={`${BASE}/${record.id}/audio`} style={{ width: '100%' }} />
      )}
    </div>
  );
}
