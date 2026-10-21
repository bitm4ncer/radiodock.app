// RadioDock service worker — app-shell cache.
//
// Strategy:
//   - Network-FIRST for the HTML document (/, *.html): always load the current
//     index.html so it references the current hashed asset filenames; fall
//     back to the cached shell only when offline. Cache-first here is a trap
//     for a hashed-asset SPA — a background-refreshed index.html would point
//     at new asset hashes that weren't cached, so an offline/flaky launch
//     served fresh HTML with missing JS/CSS → an unstyled page.
//   - Network-FIRST for dashboard-published curation data (community-radios.json):
//     a Publish must reach every user on their next load, not a deploy + reload
//     later. Falls back to the cached copy offline, or on a slow network via a
//     short timeout, so boot never stalls.
//   - Cache-FIRST for hashed assets, icons, fonts (immutable-hashed), revalidated
//     in the background. Survives offline.
//   - Network-only for everything else (Radio Browser API, metadata proxy,
//     audio streams). Cache-first there would serve stale "Now Playing".
//
// Cache name is bumped on every deploy via the BUILD_ID placeholder that
// Vite replaces at build time. The activate handler purges old caches.

const BUILD_ID = "__BUILD_ID__";
const CACHE_NAME = `radiodock-shell-${BUILD_ID}`;

// Files known at install time that should be cached for offline boot.
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/community-radios.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/icon.svg',
  '/logo-text.svg',
  '/fonts/InterVariable.woff2',
];

// Dashboard-published curation data served network-first — must reach users
// promptly. (metadata-overrides.json can join this list when it ships.)
const NETWORK_FIRST_DATA = ['/community-radios.json', '/discover.json'];
const NETWORK_FIRST_TIMEOUT_MS = 4000;

function isNetworkFirstData(url) {
  return url.origin === self.location.origin && NETWORK_FIRST_DATA.includes(url.pathname);
}

function fetchWithTimeout(req, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  // `cache: 'no-store'` bypasses the browser HTTP cache — GitHub Pages serves
  // everything with `Cache-Control: max-age=600`, so a plain fetch would return
  // the 10-min-stale copy and defeat network-first. This forces a fresh hit to
  // the origin (the published file), which is the whole point here.
  return fetch(req, { signal: ctl.signal, cache: 'no-store' }).finally(() => clearTimeout(timer));
}

// The hashed JS/CSS bundles are only referenced by the freshly-fetched shell,
// so the install-time precache list can't name them. Parse them out of the
// shell HTML and cache them too, so an offline reload (and any lazy import)
// still finds its bundles after a deploy.
async function precacheHashedAssets(cache) {
  let html;
  try {
    const res = await fetch('/');
    if (!res.ok) return;
    html = await res.text();
  } catch {
    return;
  }
  const urls = new Set();
  const attrRe = /(?:src|href)=["']([^"']+)["']/g;
  let m;
  while ((m = attrRe.exec(html))) {
    const url = m[1];
    if (url.startsWith('/assets/') && /\.(js|css)$/.test(url)) urls.add(url);
  }
  if (urls.size) await cache.addAll([...urls]);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS).then(() => precacheHashedAssets(cache)))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      const shellCaches = keys.filter((k) => k.startsWith('radiodock-shell-')).sort();
      // Keep the current cache and the single most-recent previous one so a
      // client mid-update (or one that skipped an activation) still finds its
      // bundles; delete only the older caches.
      const previous = shellCaches.filter((k) => k !== CACHE_NAME).sort().at(-1);
      await Promise.all(
        shellCaches.filter((k) => k !== CACHE_NAME && k !== previous).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

function isAppShellRequest(url) {
  if (url.origin !== self.location.origin) return false;
  // Network-first data must reach the fetch handler below; without this it
  // falls through to the browser's HTTP cache (GitHub Pages max-age=600).
  if (isNetworkFirstData(url)) return true;
  if (url.pathname.startsWith('/assets/')) return true; // hashed Vite output
  if (PRECACHE_URLS.includes(url.pathname)) return true;
  if (url.pathname === '/' || url.pathname.endsWith('.html')) return true;
  if (url.pathname.startsWith('/icons/') || url.pathname.startsWith('/fonts/')) return true;
  return false;
}

function isHtmlRequest(req, url) {
  return req.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (!isAppShellRequest(url)) {
    return; // let the browser handle it (network)
  }

  // HTML document: network-first so it always references current asset hashes.
  if (isHtmlRequest(req, url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        try {
          const res = await fetch(req);
          if (!res.ok) throw new Error(`Network ${res.status}`);
          cache.put(req, res.clone());
          return res;
        } catch (err) {
          const cached =
            (await cache.match(req)) ||
            (await cache.match('/index.html')) ||
            (await cache.match('/'));
          if (cached) return cached;
          throw err;
        }
      })(),
    );
    return;
  }

  // Dashboard-published curation data: network-first so a Publish shows up on
  // the next load. Fall back to cache when offline or the network is too slow.
  if (isNetworkFirstData(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        try {
          const res = await fetchWithTimeout(req, NETWORK_FIRST_TIMEOUT_MS);
          if (!res.ok) throw new Error(`Network ${res.status}`);
          cache.put(req, res.clone());
          return res;
        } catch (err) {
          const cached = await cache.match(req);
          if (cached) return cached;
          throw err;
        }
      })(),
    );
    return;
  }

  // Hashed assets / icons / fonts: cache-first + background refresh.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      if (cached) {
        fetch(req)
          .then((res) => { if (res && res.ok) cache.put(req, res.clone()); })
          .catch(() => {});
        return cached;
      }
      const res = await fetch(req);
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    })(),
  );
});
