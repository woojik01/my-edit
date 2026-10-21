import assert from 'node:assert/strict';
import { test } from 'node:test';
import { markdownToHtml } from '../app/src/preview.ts';

test('Markdown preview formats common blocks and inline styles', () => {
  const html = markdownToHtml('# Title\n\n**bold** and `code`\n\n- one\n- two');
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /<ul>[\s\S]*<li>one<\/li>[\s\S]*<li>two<\/li>[\s\S]*<\/ul>/);
});

test('Markdown preview escapes raw HTML and blocks unsafe link schemes', () => {
  const html = markdownToHtml('<script>alert(1)</script>\n\n[run](javascript:alert(1))');
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('href="javascript:'));
});
