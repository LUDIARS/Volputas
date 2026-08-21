// 情報サーフェス 1 枚分の描画 (spec 追補 §呼び出し)。
// 描画実装は持たない: markdown は MarkdownPanel、chart は ChartPanel に
// そのまま渡す (```chart フェンスは MarkdownPanel 内の renderChartFence が拾う)。
// 操作要素は一切置かない — サーフェスは見せるだけの面 (§不変条件 1)。
import { useEffect, useState } from 'react';
import MarkdownPanel from './MarkdownPanel.jsx';
import ChartPanel from './ChartPanel.jsx';
import ErrorCard from '../markdown/ErrorCard.jsx';
import { normalizeSurfaceContent } from '../lib/surfaceContent.js';
import {
  OVERLAY_EVENTS,
  onOverlayEvent,
  surfaceDescriptor,
} from '../lib/overlayBridge.js';

function SurfaceContent({ content }) {
  let normalized;
  try {
    normalized = normalizeSurfaceContent(content);
  } catch (error) {
    return <ErrorCard error={{ code: error.code || 'SURFACE_INVALID_CONTENT', message: String(error.message || error) }} />;
  }
  if (normalized.kind === 'markdown') return <MarkdownPanel source={normalized.source} />;
  return <ChartPanel chart={normalized.chart} />;
}

/** @implements SPEC-WINDOW-OVERLAY-EXTENSION */
export default function SurfaceView({ id }) {
  const [state, setState] = useState({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    surfaceDescriptor(id)
      .then((descriptor) => {
        if (!cancelled) setState({ status: 'ready', content: descriptor?.content });
      })
      .catch((error) => {
        if (!cancelled) {
          setState({
            status: 'error',
            error: { code: error.code || 'SURFACE_LOAD_FAILED', message: String(error.message || error) },
          });
        }
      });
    return () => { cancelled = true; };
  }, [id]);

  // update({ content }) は Rust 側からこのウインドウ宛てに飛んでくる。
  useEffect(() => onOverlayEvent(OVERLAY_EVENTS.surfaceUpdated, (payload) => {
    if (payload?.id === id) setState({ status: 'ready', content: payload.content });
  }), [id]);

  if (state.status === 'loading') return <div className="overlay-surface overlay-surface-loading" />;
  if (state.status === 'error') {
    return (
      <div className="overlay-surface">
        <ErrorCard error={state.error} />
      </div>
    );
  }
  return (
    <div className="overlay-surface">
      <SurfaceContent content={state.content} />
    </div>
  );
}
