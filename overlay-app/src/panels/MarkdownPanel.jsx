// Markdown パネル (spec §Markdown / task T5)。
// ソースは file (Rust 側の notify でライブリロード) / inline / api の 3 種。
// 生 HTML は許可しない: plugin 構成は markdownRuntime.js が正本で、
// 起動時に assertMarkdownPolicy が破られていないことを確かめる。
import { useCallback, useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { assertMarkdownPolicy, linkPropsFor, MARKDOWN_POLICY } from '../markdown/markdownPolicy.js';
import { MARKDOWN_RUNTIME } from '../markdown/markdownRuntime.js';
import { renderChartFence } from '../markdown/renderChartFence.jsx';
import ErrorCard from '../markdown/ErrorCard.jsx';
import {
  OVERLAY_EVENTS,
  onOverlayEvent,
  readMarkdown,
  unwatchMarkdown,
  watchMarkdown,
} from '../lib/overlayBridge.js';

const REMARK_PLUGINS = { 'remark-gfm': remarkGfm };

assertMarkdownPolicy(MARKDOWN_RUNTIME);
const remarkPlugins = MARKDOWN_RUNTIME.remarkPluginNames.map((name) => REMARK_PLUGINS[name]);

function MarkdownLink({ href, children }) {
  const link = linkPropsFor(href);
  if (!link.external) return <span className="overlay-link-disabled">{children}</span>;
  // WebView は遷移させない: Rust 側の opener が既定ブラウザへ渡す。
  return (
    <a
      href={link.href}
      target={link.target}
      rel={link.rel}
      onClick={(event) => { event.preventDefault(); window.open(link.href, '_blank'); }}
    >
      {children}
    </a>
  );
}

const COMPONENTS = { code: renderChartFence, a: MarkdownLink };

/** @implements SPEC-WINDOW-OVERLAY-EXTENSION */
export default function MarkdownPanel({ source }) {
  const [state, setState] = useState({ status: 'loading', markdown: '' });

  const load = useCallback(async () => {
    if (source.kind === 'inline') {
      setState({ status: 'ready', markdown: source.markdown || '' });
      return;
    }
    try {
      const loaded = await readMarkdown(source);
      setState({ status: 'ready', markdown: loaded.markdown || '' });
    } catch (error) {
      setState({
        status: 'error',
        error: { code: error.code || 'MARKDOWN_LOAD_FAILED', message: String(error.message || error) },
      });
    }
  }, [source.kind, source.path, source.markdown]);

  useEffect(() => { load(); }, [load]);

  // file ソースだけ notify の変更通知を購読する (spec §Markdown ライブリロード)。
  useEffect(() => {
    if (source.kind !== 'file') return undefined;
    let active = true;
    let registered = false;
    watchMarkdown(source.path).then(() => {
      registered = true;
      if (!active) unwatchMarkdown(source.path).catch(() => {});
    }).catch(() => {});
    const stopListening = onOverlayEvent(OVERLAY_EVENTS.markdownChanged, (changed) => {
      if (!changed || changed.path === source.path) load();
    });
    return () => {
      active = false;
      stopListening();
      if (registered) unwatchMarkdown(source.path).catch(() => {});
    };
  }, [source.kind, source.path, load]);

  if (state.status === 'error') return <ErrorCard error={state.error} />;
  return (
    <div className="overlay-markdown">
      <Markdown
        remarkPlugins={remarkPlugins}
        skipHtml={MARKDOWN_POLICY.skipHtml}
        disallowedElements={MARKDOWN_POLICY.disallowedElements}
        unwrapDisallowed={MARKDOWN_POLICY.unwrapDisallowed}
        components={COMPONENTS}
      >
        {state.markdown}
      </Markdown>
    </div>
  );
}
