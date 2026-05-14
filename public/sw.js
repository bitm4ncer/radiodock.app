// RadioDock service worker — app-shell cache only.
//
// Strategy:
//   - Cache-first for the app shell (index.html + hashed JS/CSS + icons +
//     community-radios.json). Survives offline.
//   - Network-only for everything else (Radio Browser API, metadata proxy,
//     audio streams). Cache-first on those would serve stale "Now Playing".
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

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (!isAppShellRequest(url)) {
    return; // let the browser handle it (network)
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      if (cached) {
        // Refresh in the background so the next visit is up-to-date.
        fetch(req)
          .then((res) => {
            if (res && res.ok) cache.put(req, res.clone());
          })
          .catch(() => {});
        return cached;
      }
      try {
        const res = await fetch(req);
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      } catch (err) {
        // Last-resort offline fallback for navigations: serve index.html.
        if (req.mode === 'navigate') {
          const fallback = await cache.match('/index.html');
          if (fallback) return fallback;
        }
        throw err;
      }
    })(),
  );
});
