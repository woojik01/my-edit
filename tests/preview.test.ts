import assert from 'node:assert/strict';
import { test } from 'node:test';
import { instrumentHtmlPreview, markdownToHtml } from '../app/src/preview.ts';

test('HTML preview adds a runtime and console error bridge inside head', () => {
  const html = instrumentHtmlPreview('<!doctype html><html><head><title>Test</title></head><body></body></html>', 'preview-token');
  assert.match(html, /<head><script>/);
  assert.match(html, /my-edit-preview-log/);
  assert.match(html, /unhandledrejection/);
  assert.match(html, /console\.error/);
  assert.ok(html.indexOf('<script>') < html.indexOf('<title>Test</title>'));
});

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
