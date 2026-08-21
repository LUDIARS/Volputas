// 単独のグラフパネル (spec §グラフ)。Markdown 内のフェンスと同じ描画経路を
// 使うので、チャートの取得・変換・エラー表示が二重にならない。
import { ChartSpecView } from '../markdown/ChartFence.jsx';
import ErrorCard from '../markdown/ErrorCard.jsx';
import { parseChartFence } from '../markdown/chartFence.js';

/** @implements SPEC-WINDOW-OVERLAY-EXTENSION */
export default function ChartPanel({ chart }) {
  const parsed = parseChartFence(JSON.stringify(chart || {}));
  if (!parsed.ok) return <ErrorCard error={parsed.error} />;
  return <ChartSpecView spec={parsed.spec} />;
}
