# RadioDock

Internet radio player for the web. Installable as a PWA on desktop and mobile, and shipped as a native desktop app for Windows, macOS and Linux.

**Live: <https://radiodock.app>**

RadioDock is the standalone web rebuild of the [RadioDock Chrome extension](https://github.com/bitm4ncer/RadioDock). It streams 50,000+ stations from RadioDock's own curated [Stations API](https://stations.radiodock.app), built on the community-run [Radio Browser](https://www.radio-browser.info/) directory, which stays the upstream source and an automatic runtime fallback. It ships with a curated community station list, serves station logos from a single origin, and keeps all user data on-device.

## Features

- **Playback** ICY/MP3 and HLS streams (`hls.js` loaded on demand), automatic error recovery with backoff, network-aware retries, lock-screen and background playback via the Media Session API.
- **Now playing** live track metadata through a dedicated [metadata proxy](https://github.com/bitm4ncer/RadioDock-metadata-proxy), in-band ID3 for HLS streams, and a desktop hover preview that shows what a station is playing before you press play.
- **Search** by name or genre against the RadioDock Stations API, with automatic Radio Browser fallback (plus a hidden backend toggle in About for debugging).
- **Lists** favorites and custom lists with drag-drop reorder, JSON import/export (extension-compatible), and shareable list URLs (gzip + base64url in the hash fragment, so the payload never touches a server).
- **Cross-device sync** end-to-end encrypted list sync via a QR code or a link. The secret lives only in the `#sync=` fragment; the server stores an AES-GCM blob keyed by a hash of the secret and can never read it. No account.
- **Notes** local-first journal for capturing radio moments (station, track, timestamp) with pages, search, and export. Note cards can show a track preview from Spotify, Apple Music, Tidal or YouTube behind a two-click consent gate.
- **Tape recording** record the current stream straight into a note and replay it inline. Desktop captures client-side through a relay on the Stations server; mobile (where WebKit cannot capture) records server-side and survives an app restart.
- **Identify** a Shazam-style Detect button captures a few seconds of the live stream server-side and writes the recognised track into a note. Daily per-device cap, no audio retained.
- **Database panel** submit a station to the public curated directory (reviewed by hand before it goes live), or add a private custom stream that never leaves the device.
- **Backgrounds** gradient editor and image gallery for customising the app surface.
- **Desktop app** Electron shell around the live site: system tray with playback state, always-on-top, auto-start, frameless compact window, and a tiny-player pill that docks to the corner. Windows, macOS (universal) and Linux (AppImage + Flatpak).
- **PWA** offline app shell via service worker, per-platform install flows, standalone-mode layouts, keyboard shortcuts, light and dark themes.
- **Visualizer** (desktop) Canvas 2D and WebGL visualizers plus Milkdrop presets via [butterchurn](https://github.com/jberg/butterchurn), driven by a tiered audio pipeline. Built end to end but feature-flagged off in production (`VISUALIZER_ENABLED` in `src/main.js`).

## Technical overview

- **Stack:** Vite 5 + vanilla JS. No framework, no state library, plain ES modules. `hls.js` and `butterchurn` are dynamically imported so they never touch the initial bundle.
- **Persistence:** IndexedDB throughout (lists, preferences, notes, recordings). No accounts, no localStorage.
- **Audio:** a single `<audio>` element in the main DOM (required for background playback). Stream URLs are HTTPS-upgraded on secure contexts to avoid mixed-content blocks; `crossorigin` is deliberately absent since most radio streams lack CORS headers.
- **Layout:** mobile-first CSS, centered column capped at 480px, separate mobile and desktop regimes behind media queries, plus a standalone regime for installed apps.
- **Analytics:** self-hosted, cookieless Umami. Anonymous usage events only, no query strings, no PII.
- **Tests:** `node --test` over the pure-logic modules (station sources, sync, notes snapshots, import/export, detect quota, embeds). The Pages deploy is gated on them.

```
src/
├─ main.js          orchestration, state, bootstrap
├─ platform.js      platform / standalone detection, install prompt capture
├─ player/          audio element, HLS branch, recovery, metadata polling,
│                   media session, desktop + mobile recorders
├─ data/            IndexedDB storage, lists, notes, import/export, share links,
│                   sync, station + metadata API clients, submissions, relay
├─ features/        detect (track recognition) and its client-side quota
├─ analytics/       Umami wrapper, listening heartbeat
├─ ui/              player card, station list, search, notes, sync panel,
│                   database panel, modals, drawers, toasts, Electron bridge
├─ visualizer/      engine (Canvas 2D + WebGL), audio source tiers, registry
├─ visualizers/     individual visualizer modules
└─ styles/          component-split CSS

desktop/            Electron main process, preload bridge, tray, build config
```

## Services

- **[RadioDock Stations API](https://stations.radiodock.app)** curated station directory, search, single-origin logo CDN (`/logos/{uuid}`), recording relay, detect, sync and submissions. Self-hosted on a Hetzner VPS from the `RadioDock-Stations` repo, which also holds the admin curation dashboard (station editor, duplicate resolution, review queue, community-list publishing, listening stats) and the nightly data pipeline.
- **[Radio Browser API](https://www.radio-browser.info/)** the upstream community-run directory our data is built from, and the automatic search and info fallback when the Stations API is unreachable. It stays wired in permanently.
- **[RadioDock metadata proxy](https://github.com/bitm4ncer/RadioDock-metadata-proxy)** now-playing metadata for ICY streams (Hetzner primary, Render fallback).

The community station list in `public/community-radios.json` is curated in that dashboard and published from there straight into this repo, which triggers the normal Pages deploy.

## Deployment

Push to `main`, GitHub Actions runs the tests, builds, and deploys to GitHub Pages under the custom domain. The user-facing version label is derived automatically from the git commit count.

Desktop installers are built by a separate workflow and published to a single GitHub release tagged `latest`, always at the same asset names:

- [Windows](https://github.com/bitm4ncer/radiodock.app/releases/latest/download/RadioDock-win.exe)
- [macOS](https://github.com/bitm4ncer/radiodock.app/releases/latest/download/RadioDock-mac.dmg)
- [Linux (AppImage)](https://github.com/bitm4ncer/radiodock.app/releases/latest/download/RadioDock-linux.AppImage)

The desktop builds are unsigned, so Windows SmartScreen and macOS Gatekeeper need a manual bypass on first launch.

## Development

```bash
npm install
npm run dev     # http://localhost:5173
npm test
npm run build
```
