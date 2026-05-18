// Renders the station logo with an auto-fallback chain
// (original favicon → DuckDuckGo → initials) and a hover/long-press
// cycle button that lets the user manually pin a preferred source.
//
// The HTML is rendered as a string (so it can be embedded in the
// existing innerHTML templates of station-list and search). After
// rendering, call mountLogoBehavior(rootEl) once per host — it uses
// event delegation, so newly rendered rows pick up the behaviour
// without re-mounting.

import {
  LOGO_SOURCES,
  getLogoCandidates,
  getLogoOverride,
  setLogoOverride,
  isDdgPlaceholder,
} from '../data/logo-resolver.js';
import { toast } from './toast.js';

// 500 ms is the long-press window that feels deliberate without
// blocking a normal tap.
const LONG_PRESS_MS = 500;
// If the pointer moves more than this between down and the long-press
// timer firing, treat it as a scroll/drag, not a press.
const LONG_PRESS_MOVE_TOL = 8;

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

// Render a logo slot suitable for embedding in a list/search row.
// `imgClass` / `initialsClass` let callers reuse the existing CSS
// classnames (`station-item-logo` / `station-item-initials`).
export function renderLogoSlot(station, {
  imgClass = 'station-item-logo',
  initialsClass = 'station-item-initials',
  size = 'sm', // 'sm' for list rows, 'lg' for player card
} = {}) {
  const initials = getInitials(station.name);
  const candidates = getLogoCandidates(station);
  const datasetParts = [
    `data-logo-slot="1"`,
    `data-station-id="${escapeHtml(station.id ?? '')}"`,
    `data-initials="${escapeHtml(initials)}"`,
    `data-size="${size}"`,
  ];
  for (const c of candidates) {
    if (c.source !== LOGO_SOURCES.INITIALS) {
      datasetParts.push(`data-${c.source}-url="${escapeHtml(c.url)}"`);
    }
  }
  // First render: pessimistic — show initials. The mount step replaces
  // with the appropriate img once it's resolved an override / first
  // candidate. This keeps the markup stable even if station.favicon is
  // a broken URL that would otherwise flash before erroring.
  return `<span class="logo-slot logo-slot--${size}" ${datasetParts.join(' ')}>
    <span class="${initialsClass}">${escapeHtml(initials)}</span>
    <button type="button" class="logo-cycle-btn" tabindex="-1" aria-label="Switch logo source">
      <svg viewBox="0 0 24 24" aria-hidden="true" width="14" height="14"><path d="M4 12a8 8 0 0 1 13.5-5.7L20 4v6h-6l2.4-2.4A6 6 0 0 0 6 12H4Zm16 0a8 8 0 0 1-13.5 5.7L4 20v-6h6l-2.4 2.4A6 6 0 0 0 18 12h2Z" fill="currentColor"/></svg>
    </button>
  </span>`;
}

// ---- Mount behaviour (one-time per host) ----

const MOUNTED = new WeakSet();

export function mountLogoBehavior(rootEl, { imgClass = 'station-item-logo', initialsClass = 'station-item-initials' } = {}) {
  if (!rootEl || MOUNTED.has(rootEl)) return;
  MOUNTED.add(rootEl);

  // Apply resolved logo source to every slot currently in the DOM, and
  // again whenever new slots appear (via MutationObserver).
  const resolveSlot = (slot) => {
    if (slot.dataset.logoResolved === '1') return;
    slot.dataset.logoResolved = '1';
    const stationId = slot.dataset.stationId;
    const originalUrl = slot.dataset.originalUrl || '';
    const ddgUrl = slot.dataset.ddgUrl || '';
    const initials = slot.dataset.initials || '?';

    // Build the source order. Override (if any) takes priority, then we
    // fall through to whatever candidate hasn't been tried yet.
    const candidates = [];
    if (originalUrl) candidates.push(LOGO_SOURCES.ORIGINAL);
    if (ddgUrl) candidates.push(LOGO_SOURCES.DDG);
    candidates.push(LOGO_SOURCES.INITIALS);
    slot.dataset.candidates = candidates.join(',');

    getLogoOverride(stationId).then((override) => {
      const startSource = candidates.includes(override) ? override : candidates[0];
      slot.dataset.activeSource = startSource;
      slot.dataset.overridden = override ? '1' : '0';
      applySource(slot, startSource, { imgClass, initialsClass });
    });
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

  // ---- Cycle button: hover (CSS) for desktop, long-press for touch ----
  // The button only triggers — auto-fallback inside the img onerror
  // handler takes care of broken sources without user intervention.
  // Use capture phase + stopImmediatePropagation so we beat the
  // sibling row click handler that lives on the same rowsHost element
  // (station-list / search). Plain stopPropagation only blocks
  // *parent* listeners — co-registered ones on the same node still
  // fire, which would trigger play-station and re-render the list
  // out from under our slot.
  rootEl.addEventListener('click', (evt) => {
    const btn = evt.target.closest('.logo-cycle-btn');
    if (!btn) return;
    const slot = btn.closest('[data-logo-slot="1"]');
    if (!slot) return;
    evt.stopImmediatePropagation();
    evt.preventDefault();
    cycleSlot(slot, { imgClass, initialsClass });
  }, true);

  // Long-press to reveal the cycle button on touch. On desktop the
  // button reveals on hover via CSS, so this is a no-op there.
  let pressTimer = null;
  let pressStart = null;
  let pressedSlot = null;

  const cancelPress = () => {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
    pressStart = null;
    pressedSlot = null;
  };

  rootEl.addEventListener('pointerdown', (evt) => {
    // Only react to primary touch presses — desktop mouse uses hover.
    if (evt.pointerType !== 'touch') return;
    const slot = evt.target.closest('[data-logo-slot="1"]');
    if (!slot) return;
    pressedSlot = slot;
    pressStart = { x: evt.clientX, y: evt.clientY };
    pressTimer = setTimeout(() => {
      // Dismiss any other revealed slots first so only one is open at
      // a time.
      rootEl.querySelectorAll('.logo-slot.is-pressed').forEach((el) => {
        if (el !== slot) el.classList.remove('is-pressed');
      });
      slot.classList.add('is-pressed');
      pressTimer = null;
    }, LONG_PRESS_MS);
  }, { passive: true });

  rootEl.addEventListener('pointermove', (evt) => {
    if (!pressStart || !pressTimer) return;
    const dx = Math.abs(evt.clientX - pressStart.x);
    const dy = Math.abs(evt.clientY - pressStart.y);
    if (dx > LONG_PRESS_MOVE_TOL || dy > LONG_PRESS_MOVE_TOL) cancelPress();
  }, { passive: true });

  rootEl.addEventListener('pointerup', cancelPress, { passive: true });
  rootEl.addEventListener('pointercancel', cancelPress, { passive: true });

  // Tap outside any pressed slot to dismiss the reveal. Captured on
  // document so taps anywhere in the app dismiss.
  document.addEventListener('pointerdown', (evt) => {
    const pressed = rootEl.querySelectorAll?.('.logo-slot.is-pressed');
    if (!pressed?.length) return;
    for (const el of pressed) {
      if (el.contains(evt.target)) continue;
      el.classList.remove('is-pressed');
    }
  }, true);
}

function cycleSlot(slot, { imgClass, initialsClass }) {
  const candidates = (slot.dataset.candidates || '').split(',').filter(Boolean);
  if (candidates.length <= 1) return;
  const current = slot.dataset.activeSource || candidates[0];
  const idx = candidates.indexOf(current);
  const next = candidates[(idx + 1) % candidates.length];
  slot.dataset.activeSource = next;
  slot.dataset.overridden = '1';
  // Dismiss the touch-revealed state once the user has made a choice.
  slot.classList.remove('is-pressed');
  applySource(slot, next, { imgClass, initialsClass, manual: true });
  setLogoOverride(slot.dataset.stationId, next).catch(() => {});
  toast(labelForSource(next));
}

function labelForSource(source) {
  if (source === LOGO_SOURCES.ORIGINAL) return 'Logo: original';
  if (source === LOGO_SOURCES.DDG) return 'Logo: website favicon';
  return 'Logo: initials';
}

function applySource(slot, source, { imgClass, initialsClass, manual = false } = {}) {
  const url = source === LOGO_SOURCES.ORIGINAL ? slot.dataset.originalUrl
    : source === LOGO_SOURCES.DDG ? slot.dataset.ddgUrl
    : '';
  const initials = slot.dataset.initials || '?';

  // Always keep the cycle button in the slot. Anything else in the slot
  // (the live img or initials chip) gets replaced.
  const cycleBtn = slot.querySelector('.logo-cycle-btn');
  for (const child of Array.from(slot.children)) {
    if (child !== cycleBtn) child.remove();
  }

  if (!url) {
    const init = document.createElement('span');
    init.className = initialsClass;
    init.textContent = initials;
    slot.insertBefore(init, cycleBtn);
    return;
  }

  const img = document.createElement('img');
  img.className = imgClass;
  img.alt = '';
  img.dataset.source = source;
  img.src = url;
  img.onerror = () => {
    // Don't let an explicit user pick silently fall through to the
    // next source — that would feel like the click did nothing. The
    // override stays, the slot just renders initials.
    if (manual || slot.dataset.overridden === '1') {
      img.replaceWith(makeInitials(initials, initialsClass));
      return;
    }
    advanceToNextSource(slot, source, { imgClass, initialsClass });
  };
  img.onload = () => {
    // DDG returns a 48×48 grey-arrow placeholder for unknown domains.
    // Treat that as a soft failure.
    if (source === LOGO_SOURCES.DDG && isDdgPlaceholder(img)) {
      if (manual || slot.dataset.overridden === '1') {
        img.replaceWith(makeInitials(initials, initialsClass));
      } else {
        advanceToNextSource(slot, source, { imgClass, initialsClass });
      }
    }
  };
  slot.insertBefore(img, cycleBtn);
}

function advanceToNextSource(slot, fromSource, opts) {
  const candidates = (slot.dataset.candidates || '').split(',').filter(Boolean);
  const idx = candidates.indexOf(fromSource);
  const next = candidates[idx + 1];
  if (!next) {
    const initials = slot.dataset.initials || '?';
    const existing = slot.querySelector('img');
    if (existing) existing.replaceWith(makeInitials(initials, opts.initialsClass));
    return;
  }
  slot.dataset.activeSource = next;
  applySource(slot, next, opts);
}

function makeInitials(text, cls) {
  const el = document.createElement('span');
  el.className = cls;
  el.textContent = text;
  return el;
}
