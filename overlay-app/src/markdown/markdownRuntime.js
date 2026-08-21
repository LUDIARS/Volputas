// MarkdownPanel が実際に渡す plugin 構成 (名前だけ)。
// plugin 実体の import は JSX 側に置き、ここは node --test から読めるままにする:
// 「rehype-raw を入れない」という不変条件をテストで固定するため。
import { MARKDOWN_POLICY } from './markdownPolicy.js';

export const MARKDOWN_RUNTIME = Object.freeze({
  remarkPluginNames: Object.freeze(['remark-gfm']),
  rehypePluginNames: Object.freeze([]),
  skipHtml: MARKDOWN_POLICY.skipHtml,
});
