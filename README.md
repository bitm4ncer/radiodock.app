# RadioDock

Internet radio player for the web — installable as a PWA on desktop and mobile.

**Live: <https://radiodock.app>**

RadioDock is the standalone web rebuild of the [RadioDock Chrome extension](https://github.com/bitm4ncer/RadioDock). It streams 50K+ stations from RadioDock's own curated [Stations API](https://stations.radiodock.app) — built on the community-run [Radio Browser](https://www.radio-browser.info/) directory, which stays the upstream source and an automatic fallback — ships with a curated community station list, serves station logos from a single origin, and keeps all user data on-device.

## Features

- **Playback** — ICY/MP3 and HLS streams (`hls.js` loaded on demand), automatic error recovery with backoff, lock-screen / background playback via the Media Session API.
- **Now playing** — live track metadata through a dedicated [metadata proxy](https://github.com/bitm4ncer/RadioDock-metadata-proxy), plus in-band ID3 for HLS streams.
- **Search** — by name or genre against the RadioDock Stations API, with automatic Radio Browser fallback (and a hidden backend toggle in About for debugging).
- **Lists** — favorites and custom lists with drag-drop reorder, JSON import/export (extension-compatible), and shareable list URLs (gzip + base64url in the hash fragment — the payload never touches a server).
- **Notes** — local-first journal for capturing radio moments (station + track + timestamp) with pages, search, and export.
- **Visualizer** (desktop) — Canvas 2D and WebGL visualizers plus Milkdrop presets via [butterchurn](https://github.com/jberg/butterchurn), driven by a tiered audio pipeline (HLS/MSE → tab-audio capture → procedural fallback).
- **Backgrounds** — gradient editor and image gallery for customizing the app surface.
- **PWA** — offline app shell via service worker, install flows per platform, standalone-mode layouts.

## Technical overview

- **Stack:** Vite 5 + vanilla JS — no framework, no state library, plain ES modules. `hls.js` and `butterchurn` are the only runtime dependencies, both dynamically imported.
- **Persistence:** IndexedDB throughout (lists, preferences, notes). No accounts, no backend, no localStorage.
- **Audio:** a single `<audio>` element in the main DOM (required for background playback). Stream URLs are HTTPS-upgraded on secure contexts to avoid mixed-content blocks; `crossorigin` is deliberately absent since most radio streams lack CORS headers.
- **Layout:** mobile-first CSS, centered column capped at 480px, separate mobile/desktop regimes behind media queries.
- **Analytics:** self-hosted, cookieless Umami — anonymous usage events, no query strings or PII.

```
src/
├─ main.js          orchestration, state, bootstrap
├─ player/          audio element, HLS branch, recovery, metadata polling, media session
├─ data/            IndexedDB storage, lists, notes, import/export, share links, API clients
├─ ui/              player card, station list, search, modals, drawers, toasts
├─ visualizer/      engine (Canvas 2D + WebGL), audio source tiers, registry
├─ visualizers/     individual visualizer modules
└─ styles/          component-split CSS
```

## Services

- **[RadioDock Stations API](https://stations.radiodock.app)** — curated station directory, search, and single-origin logo CDN (`/logos/{uuid}`); self-hosted.
- **[Radio Browser API](https://www.radio-browser.info/)** — the upstream community-run directory our data is built from, and the automatic search/info fallback when the Stations API is unreachable.
- **[RadioDock metadata proxy](https://github.com/bitm4ncer/RadioDock-metadata-proxy)** — now-playing metadata for ICY streams (Hetzner primary, Render fallback).

## Deployment

Push to `main` → GitHub Actions builds and deploys to GitHub Pages under the custom domain. The user-facing version label is derived automatically from the git commit count.

For local development: `npm install && npm run dev`.
