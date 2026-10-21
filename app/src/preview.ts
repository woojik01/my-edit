const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

function inlineMarkdown(value: string): string {
  let html = escapeHtml(value);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, rawUrl: string) => {
    const url = rawUrl.trim();
    if (!/^(https?:|mailto:)/i.test(url)) return label;
    return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
  return html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
}

export function instrumentHtmlPreview(source: string, channel: string): string {
  const bridge = `<script>(()=>{
    const channel=${JSON.stringify(channel)};
    const stringify=value=>{if(value instanceof Error)return value.stack||value.message;if(typeof value==='string')return value;try{const json=JSON.stringify(value);return json===undefined?String(value):json}catch{return String(value)}};
    const send=(kind,values)=>{try{parent.postMessage({type:'my-edit-preview-log',channel,kind,message:values.map(stringify).join(' ').slice(0,4000)},'*')}catch{}};
    addEventListener('error',event=>send('runtime error',[event.message||'스크립트 오류',event.filename?event.filename+':'+(event.lineno||0)+':'+(event.colno||0):'']));
    addEventListener('unhandledrejection',event=>send('promise rejection',[event.reason]));
    const originalError=console.error.bind(console);console.error=(...values)=>{send('console.error',values);originalError(...values)};
  })()<\/script>`;
  const head = /<head\b[^>]*>/i.exec(source);
  if (head) return `${source.slice(0, head.index + head[0].length)}${bridge}${source.slice(head.index + head[0].length)}`;
  return `${bridge}${source}`;
}

export function markdownToHtml(source: string): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  let code: string[] | null = null;
  const flushParagraph = () => { if (paragraph.length) { blocks.push(`<p>${paragraph.map(inlineMarkdown).join('<br>')}</p>`); paragraph = []; } };
  const flushList = () => { if (list) { blocks.push(`</${list}>`); list = null; } };
  for (const line of lines) {
    const fence = /^\s*```/.test(line);
    if (code) {
      if (fence) { blocks.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`); code = null; }
      else code.push(line);
      continue;
    }
    if (fence) { flushParagraph(); flushList(); code = []; continue; }
    if (!line.trim()) { flushParagraph(); flushList(); continue; }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) { flushParagraph(); flushList(); const level = heading[1]!.length; blocks.push(`<h${level}>${inlineMarkdown(heading[2]!)}</h${level}>`); continue; }
    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) { flushParagraph(); flushList(); blocks.push('<hr>'); continue; }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) { flushParagraph(); flushList(); blocks.push(`<blockquote>${inlineMarkdown(quote[1]!)}</blockquote>`); continue; }
    const item = /^\s*(?:[-+*]\s+|(\d+)\.\s+)(.*)$/.exec(line);
    if (item) {
      flushParagraph(); const nextList = item[1] ? 'ol' : 'ul';
      if (list !== nextList) { flushList(); list = nextList; blocks.push(`<${list}>`); }
      blocks.push(`<li>${inlineMarkdown(item[2]!)}</li>`); continue;
    }
    flushList(); paragraph.push(line);
  }
  if (code) blocks.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
  flushParagraph(); flushList();
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    :root{color-scheme:light dark;font:16px/1.7 system-ui,sans-serif}body{max-width:900px;margin:0 auto;padding:28px;color:#202820;background:#fff;overflow-wrap:anywhere}h1,h2,h3{line-height:1.25;margin-top:1.5em}h1{border-bottom:1px solid #ddd;padding-bottom:.3em}a{color:#286d47}code,pre{font-family:ui-monospace,monospace;background:#f1f3f1;border-radius:4px}code{padding:.15em .35em}pre{padding:16px;overflow:auto}pre code{padding:0;background:transparent}blockquote{margin-left:0;padding-left:16px;border-left:3px solid #8ba37c;color:#556050}li{padding-left:4px}hr{border:0;border-top:1px solid #ddd}@media(prefers-color-scheme:dark){body{color:#e5e9e2;background:#171b1c}a{color:#a6d6aa}code,pre{background:#242b26}blockquote{color:#aeb9ab}hr,h1{border-color:#3e4940}}
  </style></head><body>${blocks.join('\n')}</body></html>`;
}
