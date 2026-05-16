# RadioDock — Claude guidance

PWA rebuild of the RadioDock Chrome extension. Lives at <https://radiodock.app> (GitHub Pages, custom domain). Source repo is `bitm4ncer/radiodock.app`. The original extension lives at `C:\GitHub\RadioDock` and is the source of truth for visual styling, copy, and station data.

## Project status

Follow [ROADMAP.md](./ROADMAP.md). It is the user's primary status surface — **tick checkboxes after every milestone commit**. M0–M4 are done; M5+ pending.

## Stack

- Vite 5 + vanilla JS (no framework).
- No bundler magic — plain ES modules, dynamic `import()` for `hls.js` only.
- IndexedDB for persistence (no localStorage except where unavoidable).
- GitHub Actions deploys `dist/` to Pages on push to `main`.

Local dev:

```bash
npm install
npm run dev       # http://localhost:5173 (PORT env wins for Claude Preview)
npm run build
```

## Module layout

```
src/
├─ main.js                # orchestration, state, callbacks, bootstrap
├─ player/
│  ├─ audio.js            # <audio> wrapper, HLS branch, EventTarget bus
│  ├─ recovery.js         # error/stalled/ended retry with backoff
│  └─ metadata-poller.js  # poll proxy for now-playing, pauses on tab-hidden
├─ data/
│  ├─ storage.js          # IndexedDB wrapper (lists, prefs stores)
│  ├─ lists.js            # high-level list ops, lazy default Favorites
│  ├─ import-export.js    # JSON export/import (extension-compatible)
│  ├─ radio-browser.js    # Radio Browser API client + mirror fallback
│  └─ metadata.js         # radiodock-metadata-proxy client
├─ ui/
│  ├─ player-card.js
│  ├─ station-list.js     # drag-drop reorder, remove-from-list
│  ├─ list-dropdown.js    # rename/export/delete per row
│  ├─ search.js
│  ├─ modals.js           # open/close manager
│  ├─ modal-helpers.js    # promise-based prompt/confirm
│  └─ toast.js
└─ styles/                # split by component, classnames mirror popup.css
```

## Hard rules

- **Mobile-first CSS.** Default styles target ≥ mobile, scale up via `min-width` media queries. Page is a centered column, max 480px. Dark gray `#1a1a1a` background.
- **Use the popup's existing CSS classnames verbatim.** The styles split was a mechanical port — `station-item`, `station-item-logo`, `list-item.active`, `btn-remove`, `btn-drag`, `modal.show`, etc. Don't invent BEM variants. Match the names so the CSS just works.
- **Audio element must live in the main DOM** (no Web Audio, no offscreen). Plays-in-background relies on it.
- **`crossorigin` attribute is forbidden on `<audio>`.** Most radio streams lack CORS headers and the attribute would block them.
- **HTTPS-upgrade `http://` stream URLs** on secure contexts (`window.isSecureContext`). Already handled in `audio.js#preferHttps`. Many community stations are HTTP-only and would otherwise hit mixed-content blocks.
- **HLS detection is canonical** (`Hls.isSupported()` first, native `canPlayType('application/vnd.apple.mpegurl')` second). `hls.js` is loaded via dynamic `import('hls.js')` only when an HLS URL is selected.
- **No backwards-compat hacks.** This is a fresh PWA, not a port of the extension's chrome.* plumbing.

## Versioning

User-facing version label is **auto-derived** from the git commit count
on `main`. Formula in `vite.config.js#appVersion`:

```
v${VERSION_MAJOR_MINOR}.${(git rev-list --count HEAD) - VERSION_BASELINE_COMMIT_COUNT}
```

- `VERSION_MAJOR_MINOR` — hardcoded prefix (e.g. `1.0`). Bump manually for a new minor cycle (and reset the baseline to the current commit count when you do).
- `VERSION_BASELINE_COMMIT_COUNT` — commit count just before the first commit of the current minor cycle.
- Patch number rises by **+1 on every commit to `main`** automatically. No manual bumping, no `npm version` calls, no pre-commit hooks.

The value is exposed as the `__APP_VERSION__` build-time constant via Vite's `define` and rendered into every element with class `app-version` by `main.js`. Two display sites today: the About modal header (`<h3 class="app-version">`) and the off-canvas drawer's bottom-right corner (`.off-canvas__version`).

`.github/workflows/deploy.yml` checkout uses `fetch-depth: 0` — without it the runner has a shallow clone and `git rev-list --count HEAD` would always be 1.

## Conventions

- Default to writing no code comments. Only write a comment when the WHY is non-obvious — a hidden constraint, a workaround, a subtle invariant. No "// updates the station" narration.
- Don't reference the current task/PR/issue in comments (those belong in commit messages).
- IndexedDB writes go through `data/lists.js` or `data/storage.js`; never reach into IndexedDB from a UI module.
- UI modules expose `mount...()` returning an object of callbacks (`onClick`, `onAdd`, …). `main.js` is the only place that knows about both UI and data.
- Add behavioural verification with the Claude Preview MCP after every observable change. Don't claim something works without DOM/state evidence.

## Reused services

- **Metadata proxy:** `https://radiodock-metadata-proxy-1.onrender.com/v1/metadata` — owned by the user (separate repo `bitm4ncer/RadioDock-metadata-proxy`). Returns `{ ok, source, artist, title, display, cacheTtl }`. Requires the calling origin to be on its CORS allowlist (PR in that repo lands as part of M5).
- **Radio Browser API:** `https://*.api.radio-browser.info/json/stations/search` — community-run, free, CORS-enabled. Rotate mirrors on failure.

## Things that bite

- **Mixed-content on production.** Many community stations are `http://`. The `preferHttps()` helper handles it. Don't remove it.
- **iOS Safari audio rules.** Audio cannot start without a user gesture. After first user-tap, subsequent `playStation()` calls inherit the gesture and work. Background playback works as long as audio is playing at the moment the page is hidden/locked.
- **`onerror` handler on `<img class="station-item-logo">`** uses inline `this.replaceWith(...)` because the popup's CSS sized the `<img>` tag directly with class `station-item-logo`. Initials are a sibling div, not a child.
- **The CSS uses `.modal.show` for the open state**, not `.is-open` or `.modal--open`. `src/ui/modals.js` toggles `.show`.
- **Community list is read-only.** ID is the sentinel `__community__`. `listsApi.addStationToList(...)` and the heart icon target Favorites instead when the active list is community.

## Where to look for things

- Visual reference for any UI change: `C:\GitHub\RadioDock\popup.html` + `popup.css`.
- Behavioural reference for interactions: `C:\GitHub\RadioDock\popup.js` (search the class methods).
- Community station list shape: `public/community-radios.json` — `{ version, exportDate, listName, stations: [{id, name, url, countrycode, favicon, homepage}] }`.

## Don't

- Don't add JS frameworks (React/Svelte/etc). Stay vanilla.
- Don't introduce a state management library. The state object in `main.js` is enough.
- Don't add `localStorage` writes; IndexedDB is the store.
- Don't bundle `hls.js` eagerly. Keep the dynamic import — it adds ~520 kB.
- Don't write planning/decision docs unless asked. Keep notes in conversation; ship code.
