import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const basePath = '/my-edit/';

export default defineConfig({
  root: 'app',
  base: basePath,
  plugins: [
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg'],
      manifest: {
        id: basePath,
        name: 'My Edit — Code & Text Editor',
        short_name: 'My Edit',
        description: 'Open, create and edit code, text and configuration files offline.',
        lang: 'ko',
        start_url: basePath,
        scope: basePath,
        display: 'standalone',
        orientation: 'any',
        theme_color: '#1e2620',
        background_color: '#171b1c',
        icons: [
          { src: `${basePath}icons/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: `${basePath}icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: `${basePath}icons/icon-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        mode: 'development',
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
        navigateFallback: `${basePath}index.html`,
        cleanupOutdatedCaches: true
      }
    })
  ],
  build: { outDir: '../dist', emptyOutDir: true }
});
