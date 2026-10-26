import { useCallback, useEffect, useRef, useState } from 'react';
import { createPrivateLiveTracking } from '../lib/gaze/privateLiveTracking.js';
import { sessionClockMs } from '../lib/captureRecording.js';

/** @implements SPEC-PRIVATE-LIVE-TRACKING */
export function usePrivateLiveTracking(active) {
  const [state, setState] = useState({ status: 'idle', sample: null, error: '' });
  const [attempt, setAttempt] = useState(0);
  const owner = useRef(null);
  const id = active?.id;
  const startedAt = active?.startedAt;
  useEffect(() => {
    if (!id) { setState({ status: 'idle', sample: null, error: '' }); return undefined; }
    let disposed = false;
    setState({ status: 'starting', sample: null, error: '' });
    const tracker = createPrivateLiveTracking({
      sessionClock: () => sessionClockMs(startedAt),
      onSample: (sample) => {
        if (!disposed) setState({ status: 'tracking', sample, error: '' });
      },
      onError: (reason) => {
        if (!disposed) setState({ status: 'error', sample: null,
          error: `目と顔を追跡できません。カメラの許可と接続を確認してください。${reason.message}` });
      },
    });
    owner.current = tracker;
    const onPageHide = () => {
      tracker.stop();
      if (!disposed) setState({ status: 'error', sample: null, error: 'ページを離れたため追跡を停止しました。再開してください。' });
    };
    window.addEventListener('pagehide', onPageHide);
    void tracker.start();
    return () => {
      disposed = true;
      window.removeEventListener('pagehide', onPageHide);
      tracker.stop();
      if (owner.current === tracker) owner.current = null;
    };
  }, [id, startedAt, attempt]);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const stop = useCallback(() => {
    owner.current?.stop();
    owner.current = null;
    setState({ status: 'idle', sample: null, error: '' });
  }, []);
  return { ...state, retry, stop };
}
