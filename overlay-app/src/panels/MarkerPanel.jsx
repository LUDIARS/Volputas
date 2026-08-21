// 感想マーカーのパネル (spec §感想拾い / task T7)。
// 投下判断は markerDispatcher.js が持ち、ここは表示とホットキー配線だけ。
import { useEffect, useMemo, useRef, useState } from 'react';
import { MarkerDispatcher } from '../lib/markerDispatcher.js';
import { MarkerQueue, MARKER_TYPES } from '../lib/markerQueue.js';
import {
  OVERLAY_EVENTS,
  localStatus,
  onOverlayEvent,
  postMarker,
  setInteractive,
} from '../lib/overlayBridge.js';

const LABELS = { hype: '盛り上がり', like: 'スキ', dislike: '嫌い', stress: 'ストレス' };
const STORAGE_KEY = 'volputas.overlay.markerQueue';
const STATUS_INTERVAL_MS = 3000;

function restoreQueue() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored ? MarkerQueue.from(JSON.parse(stored)) : new MarkerQueue();
  } catch {
    return new MarkerQueue();
  }
}

function persistQueue(queue) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(queue.toJSON()));
  } catch {
    // 永続化できなくてもメモリ上のバッファは生きている。
  }
}

/** @implements SPEC-WINDOW-OVERLAY-EXTENSION */
export default function MarkerPanel({ hotkeys }) {
  const [state, setState] = useState({ reachable: false, recording: false, pending: 0, overflowed: 0 });
  const [notice, setNotice] = useState(null);
  const [comment, setComment] = useState(null);
  const commentInput = useRef(null);
  const commentOpen = useRef(false);

  const dispatcher = useMemo(() => {
    const queue = restoreQueue();
    return new MarkerDispatcher({
      queue,
      postMarker,
      onChange: (next) => { setState(next); persistQueue(queue); },
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const status = await localStatus();
        if (!cancelled) await dispatcher.updateStatus(status);
      } catch {
        if (!cancelled) await dispatcher.updateStatus({ reachable: false, captureSession: null });
      }
    }
    void poll();
    const timer = setInterval(poll, STATUS_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [dispatcher]);

  async function drop(type, label = '') {
    const result = await dispatcher.drop({ type, label });
    setNotice(result.outcome === 'sent'
      ? LABELS[type] + ' を送信しました'
      : LABELS[type] + ' を保留しました (' + result.pending + ' 件待機)');
  }

  function closeComment() {
    commentOpen.current = false;
    setComment(null);
    // commentHotkey は Rust 側で操作可能状態にするため、入力終了時は
    // 必ず対になる解除を行う。失敗しても入力自体は閉じられる。
    // 取り下げるのは 'comment' の要求だけ。グラブハンドルに乗ったままでも
    // ヘッダの hover 要求は残るので、そちらは操作可能なままになる。
    setInteractive('comment', false).catch(() => {});
  }

  async function submitComment(event) {
    event.preventDefault();
    try {
      await drop('like', comment);
    } finally {
      closeComment();
    }
  }

  // グローバルホットキーは Rust 側が握る (WebView がクリック透過でも効く)。
  useEffect(() => onOverlayEvent(OVERLAY_EVENTS.markerHotkey, (payload) => {
    if (payload?.type) {
      void drop(payload.type).catch((cause) => setNotice(String(cause?.message || cause)));
    }
  }), [dispatcher]);

  useEffect(() => onOverlayEvent(OVERLAY_EVENTS.commentHotkey, () => {
    commentOpen.current = true;
    setComment('');
    // クリック透過はコメント入力の間だけ Rust 側で解除される。
    setTimeout(() => commentInput.current?.focus(), 0);
  }), []);

  useEffect(() => () => {
    if (commentOpen.current) setInteractive('comment', false).catch(() => {});
  }, []);

  return (
    <section className="overlay-panel overlay-markers">
      <header>
        <span className={state.reachable ? 'overlay-live' : 'overlay-offline'}>
          {state.reachable ? (state.recording ? '記録中' : 'セッション未開始') : 'local app 未起動'}
        </span>
        {state.pending > 0 ? <span className="overlay-pending">保留 {state.pending}</span> : null}
      </header>
      <div className="overlay-marker-buttons">
        {MARKER_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            className={state.recording ? '' : 'overlay-disabled'}
            title={hotkeys?.[type] || ''}
            onClick={() => {
              void drop(type).catch((cause) => setNotice(String(cause?.message || cause)));
            }}
          >
            {LABELS[type]}
            <small>{hotkeys?.[type] || ''}</small>
          </button>
        ))}
      </div>
      {comment !== null ? (
        <form
          className="overlay-comment"
          onSubmit={submitComment}
        >
          <input
            ref={commentInput}
            value={comment}
            maxLength={120}
            placeholder={'コメント (' + (hotkeys?.comment || 'Ctrl+Alt+Enter') + ')'}
            onChange={(event) => setComment(event.target.value)}
          />
          <button type="submit">送る</button>
          <button type="button" onClick={closeComment}>やめる</button>
        </form>
      ) : null}
      {notice ? <p className="overlay-notice">{notice}</p> : null}
      {state.overflowed > 0 ? (
        <p className="overlay-notice overlay-warning">
          バッファ上限に達した投下が {state.overflowed} 件あります
        </p>
      ) : null}
    </section>
  );
}
