import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const buildDirectory = join(repositoryRoot, 'dist');
const generatedPaths = new Set([
  'assets',
  'icons',
  'index.html',
  'manifest.webmanifest',
  'sw.js',
  'favicon.svg',
  '.nojekyll'
]);

for (const name of await readdir(repositoryRoot)) {
  if (generatedPaths.has(name) || /^workbox-.*\.js$/.test(name)) {
    await rm(join(repositoryRoot, name), { recursive: true, force: true });
  }
}

// Publish the current service worker's complete asset graph, excluding leftover hashes.
const sw = await readFile(join(buildDirectory, 'sw.js'), 'utf8');
const paths = new Set([...sw.matchAll(/"url"\s*:\s*"([^"]+)"/g)].map((match) => match[1]));
paths.add('sw.js'); paths.add('.nojekyll');
for (const match of sw.matchAll(/["']\.\/(workbox-[^"']+)["']/g)) paths.add(match[1].endsWith('.js') ? match[1] : `${match[1]}.js`);
for (const path of paths) {
  if (path.startsWith('/') || path.includes('..')) throw new Error(`Unexpected output path: ${path}`);
  await mkdir(dirname(join(repositoryRoot, path)), { recursive: true });
  await cp(join(buildDirectory, path), join(repositoryRoot, path));
}
await writeFile(join(repositoryRoot, '.pages-output.json'), JSON.stringify([...paths].sort(), null, 2) + '\n');

console.log('GitHub Pages files copied to the repository root.');
