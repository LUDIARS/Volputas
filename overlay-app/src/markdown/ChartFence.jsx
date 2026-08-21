// ```chart フェンス 1 個分の描画 (spec §グラフ)。
// 解析・props 変換は chartFence.js (純粋) が持ち、ここは取得と描画だけ。
import { useEffect, useState } from 'react';
import { HotspotChart, NarrativeArcChart, TrendChart, RadarChart } from '@volputas/charts';
import { chartPropsFor, parseChartFence } from './chartFence.js';
import { resolveChartData } from '../lib/chartData.js';
import { readJson } from '../lib/overlayBridge.js';
import ErrorCard from './ErrorCard.jsx';

const COMPONENTS = {
  hotspot: HotspotChart,
  'narrative-arc': NarrativeArcChart,
  trend: TrendChart,
  series: TrendChart,
  radar: RadarChart,
};

/** @implements SPEC-WINDOW-OVERLAY-EXTENSION */
export function ChartSpecView({ spec }) {
  const [state, setState] = useState({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    resolveChartData(spec.source, { readJson }).then((resolved) => {
      if (cancelled) return;
      if (!resolved.ok) {
        setState({ status: 'error', error: resolved.error });
        return;
      }
      const props = chartPropsFor(spec.type, resolved.data);
      setState(props.ok
        ? { status: 'ready', props: props.props }
        : { status: 'error', error: props.error });
    });
    return () => { cancelled = true; };
  }, [spec.type, spec.source?.kind, spec.source?.path, spec.source?.data]);

  if (state.status === 'loading') {
    return <div className="overlay-chart overlay-chart-loading">グラフを読み込み中…</div>;
  }
  if (state.status === 'error') return <ErrorCard error={state.error} />;
  const Chart = COMPONENTS[spec.type];
  return (
    <figure className="overlay-chart">
      {spec.title ? <figcaption>{spec.title}</figcaption> : null}
      <Chart {...state.props} />
    </figure>
  );
}

// Markdown 内のフェンス文字列から描画する入口。未知 type やスキーマ不一致は
// パネルを壊さずエラーカードになる。
/** @implements SPEC-WINDOW-OVERLAY-EXTENSION */
export default function ChartFence({ text }) {
  const parsed = parseChartFence(text);
  if (!parsed.ok) return <ErrorCard error={parsed.error} />;
  return <ChartSpecView spec={parsed.spec} />;
}
