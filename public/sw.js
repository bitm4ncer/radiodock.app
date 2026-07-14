// RadioDock service worker — app-shell cache.
//
// Strategy:
//   - Network-FIRST for the HTML document (/, *.html): always load the current
//     index.html so it references the current hashed asset filenames; fall
//     back to the cached shell only when offline. Cache-first here is a trap
//     for a hashed-asset SPA — a background-refreshed index.html would point
//     at new asset hashes that weren't cached, so an offline/flaky launch
//     served fresh HTML with missing JS/CSS → an unstyled page.
//   - Cache-FIRST for hashed assets, icons, fonts, community-radios.json (they
//     are immutable-hashed or tolerant of one-visit staleness), revalidated in
//     the background. Survives offline.
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

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith('radiodock-shell-') && k !== CACHE_NAME).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

function isAppShellRequest(url) {
  if (url.origin !== self.location.origin) return false;
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
          if (res && res.ok) cache.put(req, res.clone());
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

  // Hashed assets / icons / fonts / json: cache-first + background refresh.
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
