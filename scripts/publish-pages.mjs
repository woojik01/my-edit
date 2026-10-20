import { cp, readdir, rm } from 'node:fs/promises';
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

for (const name of await readdir(buildDirectory)) {
  await cp(join(buildDirectory, name), join(repositoryRoot, name), { recursive: true });
}

console.log('GitHub Pages files copied to the repository root.');
