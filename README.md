# My Edit

An offline code and text editor. Open, create and edit text files with any extension, including dotfiles and extensionless files. No account, server, analytics or external runtime CDN is used.

**Live:** https://woojik01.github.io/my-edit/  
**Shortcut:** https://woojik01.github.io/my-edit/index

## Features

- Multiple open tabs with separate contents, cursors and undo histories
- Arbitrary file names: `main.py`, `.env`, `LICENSE`, `data.json`, custom extensions, etc.
- 143 bundled language modes, automatic filename detection and manual mode selection; unknown formats remain editable as plain text
- Find/replace, line navigation, folding, bracket matching, comments, indentation and word wrap
- Open multiple files or drag and drop files into the workspace
- Preserve file names, UTF-8/UTF-16 LE/BE, BOM, and LF/CRLF/CR output
- Preview and manually decode legacy encodings, including Korean EUC-KR/CP949; legacy input is explicitly converted to UTF-8 when saved
- IndexedDB autosave, recovery history, workspace trash, JSON backup and non-overwriting backup restore
- Sandboxed previews for HTML and SVG, plus a safe Markdown preview
- Installable PWA with application assets and language modes cached for offline use

## File saving

The workspace autosaves inside the browser. This does **not** automatically overwrite an external file. On browsers with folder access, the first save asks for a folder and remembers it per document in IndexedDB. Later saves write the current filename into that folder. **저장 위치 변경** picks a new folder and saves there. If folder access is unavailable but file access is supported, the selected file handle is remembered instead. Browsers without either API request a download and cannot remember a destination. No `.html` suffix is added.

Files moved to the workspace trash can be restored, previewed, permanently deleted one by one, or emptied after confirmation. Automatic cleanup defaults to 30 days and can be set to 1–365 days. Expired items are removed while My Edit is open (hourly check) or the next time it starts. This only removes the workspace copy and its saved folder reference; any separately saved file on the device stays untouched.

UTF-8 and UTF-16 output are supported. Legacy encodings are for reading, with a preview and an explicit UTF-8 conversion notice. Unedited mixed line endings are retained; editing or applying a format normalizes them to the displayed style. Binary formats such as PDF, DOCX, archives and images are not text files; UTF-32 is not supported. Opening an external file is limited to 20 MiB each. Highlighting is disabled above 1,048,576 characters to reduce load. This input limit does not discard larger documents already stored in the workspace.

## Offline use and installation

The first visit requires a network connection. Wait for **오프라인 준비 완료** so the complete app and language cache has installed. Afterwards editing, file import/export and backups can work without a network connection. Browser data removal also removes the local workspace; keep backups or exported files.

The install badge uses the browser's PWA installation flow. A separately signed Android TWA APK and Digital Asset Links setup are not included. External resources used in the optional HTML preview need their own network access.

## Develop and verify

Use Node.js 22.6 or newer (Node.js 24 was used for the current verification).

```sh
npm ci
npm run dev
npm test
npm run typecheck
npm run build:pages
```

`app/` contains application source. `npm run build:pages` builds into `dist/`, then copies the static output into the repository root. Commit the source and generated root files together. GitHub Pages stays configured as **Deploy from a branch → main → / (root)**.

The database upgrade preserves previous HTML documents and recovery history. Old documents gain their formerly implicit `.html` extension. v1 backups remain importable.

See [the 0.3 design](docs/DESIGN.md) for storage semantics, formats and verification criteria.
