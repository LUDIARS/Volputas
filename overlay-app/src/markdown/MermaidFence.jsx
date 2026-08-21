// ```mermaid フェンス (spec §グラフ)。構成図・フロー用。
// mermaid は重いので動的 import し、失敗はエラーカードに落とす。
import { useEffect, useRef, useState } from 'react';
import ErrorCard from './ErrorCard.jsx';

let sequence = 0;

/** @implements SPEC-WINDOW-OVERLAY-EXTENSION */
export default function MermaidFence({ text }) {
  const container = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    sequence += 1;
    const id = 'overlay-mermaid-' + sequence;
    import('mermaid')
      .then(({ default: mermaid }) => {
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'dark' });
        return mermaid.render(id, text);
      })
      .then(({ svg }) => {
        if (cancelled || !container.current) return;
        // mermaid の出力は自前の SVG。Markdown 由来の生 HTML は通していない。
        container.current.innerHTML = svg;
        setError(null);
      })
      .catch((cause) => {
        if (cancelled) return;
        setError({ code: 'MERMAID_RENDER_FAILED', message: String(cause?.message || cause) });
      });
    return () => { cancelled = true; };
  }, [text]);

  if (error) return <ErrorCard error={error} />;
  return <div className="overlay-mermaid" ref={container} />;
}
