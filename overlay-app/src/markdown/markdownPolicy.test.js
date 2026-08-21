import test from 'node:test';
import assert from 'node:assert/strict';
import { assertMarkdownPolicy, linkPropsFor, MARKDOWN_POLICY } from './markdownPolicy.js';
import { MARKDOWN_RUNTIME } from './markdownRuntime.js';

test('the policy the panel actually renders with forbids raw HTML', () => {
  assert.equal(MARKDOWN_POLICY.skipHtml, true);
  assert.equal(assertMarkdownPolicy(MARKDOWN_RUNTIME), true);
  assert.deepEqual(MARKDOWN_RUNTIME.remarkPluginNames, ['remark-gfm']);
  assert.deepEqual(MARKDOWN_RUNTIME.rehypePluginNames, []);
});

test('adding rehype-raw or dropping skipHtml is refused', () => {
  assert.throws(() => assertMarkdownPolicy({ rehypePluginNames: ['rehype-raw'], skipHtml: true }), {
    code: 'MARKDOWN_RAW_HTML_FORBIDDEN',
  });
  assert.throws(() => assertMarkdownPolicy({ rehypePluginNames: [], skipHtml: false }), {
    code: 'MARKDOWN_RAW_HTML_FORBIDDEN',
  });
});

test('only http(s) links leave the overlay, and never in the WebView', () => {
  assert.deepEqual(linkPropsFor('https://example.test/doc'), {
    href: 'https://example.test/doc', external: true, rel: 'noreferrer noopener', target: '_blank',
  });
  assert.equal(linkPropsFor('javascript:alert(1)').href, null);
  assert.equal(linkPropsFor('file:///etc/passwd').external, false);
  assert.equal(linkPropsFor('./relative.md').external, false);
  assert.equal(linkPropsFor('https://user:secret@example.test/').external, false);
  assert.equal(linkPropsFor('https://').external, false);
});
