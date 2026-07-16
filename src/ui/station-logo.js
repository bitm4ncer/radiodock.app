// Renders a station logo from the single-origin CDN, with an initials fallback.
//
// The HTML is rendered as a string (so it can be embedded in the existing
// innerHTML templates of station-list, search and the player card). After
// rendering, call mountLogoBehavior(rootEl) once per host — it uses event
// delegation via a MutationObserver, so newly rendered rows pick up the
// behaviour without re-mounting.
//
// Chain: CDN logo (/logos/{uuid}) → initials. No third-party favicon hosts, no
// DuckDuckGo, no manual cycle button — a wrong logo is fixed once in the
// dashboard for everyone (see data/logo-resolver.js).

import { getLogoUrl, logoSizePx } from '../data/logo-resolver.js';

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

function getInitials(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || name[0]?.toUpperCase() || '?';
}

// Render a logo slot suitable for embedding in a list/search/player row.
// `imgClass` / `initialsClass` let callers reuse the existing CSS classnames
// (`station-item-logo` / `station-item-initials`, or `station-logo` /
// `station-initials` for the player card).
export function renderLogoSlot(station, {
  imgClass = 'station-item-logo',
  initialsClass = 'station-item-initials',
  size = 'sm', // 'sm' for list rows, 'lg' for the player card
} = {}) {
  const initials = getInitials(station.name);
  const url = getLogoUrl(station, logoSizePx(size));
  const inner = url
    ? `<img class="${escapeHtml(imgClass)}" alt="" loading="lazy" data-logo-img="1" src="${escapeHtml(url)}">`
    : `<span class="${escapeHtml(initialsClass)}">${escapeHtml(initials)}</span>`;
  return `<span class="logo-slot logo-slot--${escapeHtml(size)}" data-logo-slot="1" data-initials="${escapeHtml(initials)}" data-initials-class="${escapeHtml(initialsClass)}">${inner}</span>`;
}

// ---- Mount behaviour (one-time per host) ----
// Attaches an onerror→initials fallback to each slot's <img>, now and for any
// slot added later (MutationObserver). The img's src is already set in the
// markup, so it starts loading immediately; the error handler beats the network
// round-trip, so a 404 (station with no cached logo) degrades to initials.

const MOUNTED = new WeakSet();

export function mountLogoBehavior(rootEl, { initialsClass = 'station-item-initials' } = {}) {
  if (!rootEl || MOUNTED.has(rootEl)) return;
  MOUNTED.add(rootEl);

  const resolveSlot = (slot) => {
    if (slot.dataset.logoResolved === '1') return;
    slot.dataset.logoResolved = '1';
    const img = slot.querySelector('img[data-logo-img="1"]');
    if (!img) return;

    const toInitials = () => {
      const init = document.createElement('span');
      init.className = slot.dataset.initialsClass || initialsClass;
      init.textContent = slot.dataset.initials || '?';
      img.replaceWith(init);
    };

    // Already errored before we mounted (cached 404): swap immediately.
    if (img.complete && img.naturalWidth === 0) { toInitials(); return; }
    img.addEventListener('error', toInitials, { once: true });
  };

  const findSlots = (root) => root.querySelectorAll?.('[data-logo-slot="1"]:not([data-logo-resolved="1"])') ?? [];

  for (const slot of findSlots(rootEl)) resolveSlot(slot);

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches?.('[data-logo-slot="1"]')) resolveSlot(node);
        for (const slot of findSlots(node)) resolveSlot(slot);
      }
    }
  });
  observer.observe(rootEl, { childList: true, subtree: true });
}
