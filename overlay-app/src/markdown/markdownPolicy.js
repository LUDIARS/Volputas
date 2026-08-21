// Markdown 描画のセキュリティ境界 (spec §Markdown)。
// オーバーレイは他所の文書を映すので、生 HTML の経路を作らない:
// rehype-raw を入れないこと自体をテストできるよう、方針をデータにしている。
export const FORBIDDEN_REHYPE_PLUGINS = Object.freeze(['rehype-raw', 'rehypeRaw']);

export const MARKDOWN_POLICY = Object.freeze({
  // react-markdown は既定で生 HTML を無視するが、明示して既定変更に備える。
  skipHtml: true,
  disallowedElements: Object.freeze(['script', 'iframe', 'object', 'embed', 'style', 'form', 'input']),
  unwrapDisallowed: false,
});

/** @implements SPEC-WINDOW-OVERLAY-EXTENSION */
export function assertMarkdownPolicy({ rehypePluginNames = [], skipHtml }) {
  const forbidden = rehypePluginNames.find((name) => FORBIDDEN_REHYPE_PLUGINS.includes(name));
  if (forbidden) {
    throw Object.assign(new Error('Markdown で生 HTML を許可する plugin は使えません: ' + forbidden), {
      code: 'MARKDOWN_RAW_HTML_FORBIDDEN',
    });
  }
  if (skipHtml !== true) {
    throw Object.assign(new Error('Markdown は skipHtml=true で描画する必要があります'), {
      code: 'MARKDOWN_RAW_HTML_FORBIDDEN',
    });
  }
  return true;
}

// リンクは WebView 自体を遷移させない: 外部は既定ブラウザ、それ以外は無効。
/** @implements SPEC-WINDOW-OVERLAY-EXTENSION */
export function linkPropsFor(href) {
  const target = String(href || '');
  try {
    const parsed = new URL(target);
    if ((parsed.protocol === 'http:' || parsed.protocol === 'https:')
        && !parsed.username
        && !parsed.password) {
      return { href: parsed.href, external: true, rel: 'noreferrer noopener', target: '_blank' };
    }
  } catch {
    // Malformed and relative URLs stay inert inside the overlay.
  }
  return { href: null, external: false, rel: 'noreferrer noopener', target: null };
}
