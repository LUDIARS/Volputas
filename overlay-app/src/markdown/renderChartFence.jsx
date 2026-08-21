// react-markdown の code コンポーネント差し替え (spec §配置 renderChartFence.jsx)。
// ```chart は共有チャートへ、```mermaid は mermaid へ、それ以外は素の
// コードブロックとして描く。
import { fenceLanguageOf } from './chartFence.js';
import ChartFence from './ChartFence.jsx';
import MermaidFence from './MermaidFence.jsx';

/** @implements SPEC-WINDOW-OVERLAY-EXTENSION */
export function renderChartFence({ inline, className, children, ...rest }) {
  const language = fenceLanguageOf(className);
  const text = Array.isArray(children) ? children.join('') : String(children ?? '');
  if (!inline && language === 'chart') return <ChartFence text={text} />;
  if (!inline && language === 'mermaid') return <MermaidFence text={text} />;
  return <code className={className} {...rest}>{children}</code>;
}

export default renderChartFence;
