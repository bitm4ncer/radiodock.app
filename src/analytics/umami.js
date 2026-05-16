// Custom Umami events on top of the auto-pageview tracker loaded in
// index.html. Gated to production builds so `npm run dev` doesn't pollute
// the live dashboard. All calls are best-effort: a missing or
// late-loading umami global no-ops rather than throwing.

const ENABLED = import.meta.env.PROD;

export function track(name, data) {
  if (!ENABLED) return;
  const u = typeof window !== 'undefined' ? window.umami : null;
  if (!u || typeof u.track !== 'function') return;
  try {
    if (data !== undefined) u.track(name, data);
    else u.track(name);
  } catch {
    // Analytics failures must never break the app.
  }
}
