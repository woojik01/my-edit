# My Edit

An offline-first HTML editor PWA built for Android and desktop browsers. Documents stay in the browser's local IndexedDB; the app has no account, backend, analytics, or external runtime dependencies.

## Development

```sh
npm install
npm run dev
```

## Checks

```sh
npm run typecheck
npm run build
npm run preview
```

## GitHub Pages

In repository Settings → Pages, set the source to **GitHub Actions**. The workflow builds the app for the `/my-edit/` project path and deploys it whenever changes reach `main`. The expected site URL is `https://woojik01.github.io/my-edit/`.

## Offline behavior

The production build precaches the application shell and bundled editor. First use needs a network connection so the service worker can install its cache. After the app reports that offline use is ready, documents can be edited, previewed, imported, and exported without a connection. External resources referenced by an HTML document still require their own network access.

## Android TWA

Host the built `dist/` directory at an HTTPS origin, then package the PWA with Bubblewrap. Publish the matching Digital Asset Links file at `/.well-known/assetlinks.json` for the final Android application ID and signing certificate.

## Current scope

- Single-file HTML documents with embedded CSS and JavaScript
- Local autosave and recovery snapshots
- Import/export `.html` and whole-workspace JSON backup
- Sandboxed preview with console/error reporting
- Service worker based offline app shell

Multi-file project folders and external library management are planned for a later version.
