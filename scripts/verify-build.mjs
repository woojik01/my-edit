import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const base = '/my-edit/';
const manifest = JSON.parse(await readFile(join(root, 'manifest.webmanifest'), 'utf8'));
assert.equal(manifest.start_url, base);
assert.equal(manifest.scope, base);
assert.equal(manifest.id, base);
assert.match(manifest.name, /Code & Text Editor/);
for (const icon of manifest.icons) {
  assert.ok(icon.src.startsWith(base));
  const file = await readFile(join(root, icon.src.slice(base.length)));
  assert.equal(file.subarray(1, 4).toString(), 'PNG');
  const size = Number(icon.sizes.split('x')[0]);
  assert.equal(file.readUInt32BE(16), size);
  assert.equal(file.readUInt32BE(20), size);
}
const sw = await readFile(join(root, 'sw.js'), 'utf8');
const urls = new Set([...sw.matchAll(/"url"\s*:\s*"([^"]+)"/g)].map((match) => match[1]));
const assets = [...urls].filter((url) => url.startsWith('assets/'));
for (const asset of assets.filter((url) => url.endsWith('.js'))) {
  const code = await readFile(join(root, asset), 'utf8');
  for (const match of code.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["'](\.[^"']+\.js)["']/g)) {
    const dependency = posix.normalize(posix.join(posix.dirname(asset), match[1]));
    assert.ok(urls.has(dependency), `Imported code is not cached for offline use: ${dependency}`);
  }
}
for (const url of urls) assert.ok((await stat(join(root, url))).isFile(), `Missing precache asset: ${url}`);
for (const icon of manifest.icons) assert.ok(urls.has(icon.src.slice(base.length)), `Not cached: ${icon.src}`);
assert.ok(sw.includes(`${base}index.html`), 'Service worker navigation fallback has the wrong base path');
const html = await readFile(join(root, 'index.html'), 'utf8');
for (const match of html.matchAll(/(?:src|href)="(\/my-edit\/[^\"]+)"/g)) {
  const path = match[1].slice(base.length);
  assert.ok((await stat(join(root, path))).isFile());
  assert.ok(urls.has(path), `Entry asset is not cached: ${path}`);
}
console.log(`Verified ${assets.length} code/style chunks and ${urls.size} precache entries, Pages paths, and PNG install icons.`);
