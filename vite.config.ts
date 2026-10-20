import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const basePath = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base: basePath,
  plugins: [
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'My Edit — HTML Editor',
        short_name: 'My Edit',
        description: 'Write and preview HTML offline.',
        lang: 'ko',
        start_url: basePath,
        scope: basePath,
        display: 'standalone',
        orientation: 'any',
        theme_color: '#111318',
        background_color: '#111318',
        icons: [
          { src: `${basePath}icons/icon-192.svg`, sizes: '192x192', type: 'image/svg+xml', purpose: 'any' },
          { src: `${basePath}icons/icon-512.svg`, sizes: '512x512', type: 'image/svg+xml', purpose: 'any' },
          { src: `${basePath}icons/icon-512.svg`, sizes: '512x512', type: 'image/svg+xml', purpose: 'maskable' }
        ]
      },
      workbox: {
        mode: 'development',
        globPatterns: ['**/*.{js,css,html,svg,woff2,webmanifest}'],
        navigateFallback: `${basePath}index.html`,
        cleanupOutdatedCaches: true
      }
    })
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/@codemirror/') || id.includes('node_modules/@lezer/')) return 'codemirror';
        }
      }
    }
  }
});
