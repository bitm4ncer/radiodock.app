// Fullscreen background image with cycle controls, context menu, and gallery.
//
// Built-in images live in /public/backgrounds/ and are auto-discovered by
// probing background_NN.webp from 00 upward; the probe stops after two
// consecutive 404s (Content-Type validated so Vite's SPA fallback HTML
// doesn't get mistaken for an image). User-uploaded images are stored as
// Blobs in IndexedDB (store `userBackgrounds`).
//
// State machine (mode):
//   manual  — current image is whatever `backgroundIndex` points to;
//             cycle buttons advance / wrap.
//   shuffle — current image is derived from today's local date (changes
//             at midnight); cycle buttons still work but the selection
//             returns to the daily-shuffle choice on next applyCurrent.
//             A midnight timer triggers a fresh applyCurrent so the
//             user sees the day-change live.
//   blank   — no image displayed. Layers fade to nothing, prev/next
//             buttons hide, menu button only appears when the footer is
//             revealed (so it never decorates an empty viewport).
//
// Image composition: builtins + uploads, minus anything in the local
// `backgroundHidden` list, then sorted according to `backgroundOrder`
// (user-defined ordering from gallery DnD). New ids not in the order
// list append in natural order.

import {
  getAllUserBackgrounds,
  putUserBackground,
  deleteUserBackground,
  getPref,
  setPref,
} from '../data/storage.js';
import { createGallery } from './background-gallery.js';

const PREF_INDEX = 'backgroundIndex';
const PREF_MODE = 'backgroundMode';        // 'manual' | 'shuffle' | 'blank'
const PREF_ORDER = 'backgroundOrder';      // string[] of image ids
const PREF_HIDDEN = 'backgroundHidden';    // string[] of locally-hidden ids
const MAX_PROBE = 50;
const MISS_RUN_LIMIT = 2;
const ACCEPT_MIME = 'image/jpeg,image/png,image/webp,image/avif';
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

// --- Module state ---
let mounted = false;
let layerA = null;
let layerB = null;
let activeLayer = 'a';
let controlsEl = null;
let prevBtn = null;
let nextBtn = null;
let menuBtn = null;
let menuPopup = null;
let fileInputEl = null;
let gallery = null;
let midnightTimer = null;

let images = [];               // [{ id, kind: 'builtin' | 'user', url, name }]
let currentIdx = 0;
let mode = 'manual';
let orderIds = [];
let hiddenIds = new Set();
let objectUrls = new Map();

// ---------------------------------------------------------------- mount ---

export async function mountBackground() {
  if (mounted) return;
  mounted = true;

  // Background layers (two stacked for crossfade).
  layerB = createLayer('appBackgroundB');
  layerA = createLayer('appBackgroundA');
  document.body.prepend(layerB);
  document.body.prepend(layerA);

  // Controls (prev / menu / next).
  controlsEl = buildControls();
  document.body.appendChild(controlsEl);

  // Menu popup (created hidden; positioned on open).
  menuPopup = buildMenu();
  document.body.appendChild(menuPopup);

  // File input — appended directly to body, visually hidden but clickable.
  fileInputEl = buildFileInput();
  document.body.appendChild(fileInputEl);

  // Gallery panel (mounted lazily on first show but pre-create the object).
  gallery = createGallery({
    onSelect: selectImageById,
    onReorder: handleReorder,
    onDelete: deleteImageById,
  });

  // Outside-click / Escape handlers for menu + gallery.
  document.addEventListener('pointerdown', onDocumentPointerDown, true);
  document.addEventListener('keydown', onKeyDown);

  // Load persisted state.
  const [savedMode, savedIdx, savedOrder, savedHidden] = await Promise.all([
    getPref(PREF_MODE, 'manual'),
    getPref(PREF_INDEX, 0),
    getPref(PREF_ORDER, []),
    getPref(PREF_HIDDEN, []),
  ]);
  mode = ['manual', 'shuffle', 'blank'].includes(savedMode) ? savedMode : 'manual';
  currentIdx = Number.isInteger(savedIdx) ? savedIdx : 0;
  orderIds = Array.isArray(savedOrder) ? savedOrder : [];
  hiddenIds = new Set(Array.isArray(savedHidden) ? savedHidden : []);

  await refresh();
  if (currentIdx >= images.length) currentIdx = 0;

  await applyCurrent({ instant: true });
  updateControlsVisibility();
  scheduleNextMidnight();
}

// ---------------------------------------------------------------- DOM helpers ---

function createLayer(id) {
  const el = document.createElement('div');
  el.id = id;
  el.className = 'app-background';
  el.setAttribute('aria-hidden', 'true');
  return el;
}

function buildControls() {
  const root = document.createElement('div');
  root.className = 'bg-controls';
  root.innerHTML = `
    <button type="button" class="bg-btn bg-btn--prev" aria-label="Previous background" title="Previous background">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M15 6l-6 6 6 6"/>
      </svg>
    </button>
    <button type="button" class="bg-btn bg-btn--menu" aria-label="Background menu" title="Background options" aria-haspopup="menu" aria-expanded="false">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="6" r="1.6" fill="currentColor"/>
        <circle cx="12" cy="12" r="1.6" fill="currentColor"/>
        <circle cx="12" cy="18" r="1.6" fill="currentColor"/>
      </svg>
    </button>
    <button type="button" class="bg-btn bg-btn--next" aria-label="Next background" title="Next background">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M9 6l6 6-6 6"/>
      </svg>
    </button>
  `;
  prevBtn = root.querySelector('.bg-btn--prev');
  nextBtn = root.querySelector('.bg-btn--next');
  menuBtn = root.querySelector('.bg-btn--menu');
  prevBtn.addEventListener('click', () => cycle(-1));
  nextBtn.addEventListener('click', () => cycle(1));
  menuBtn.addEventListener('click', toggleMenu);
  return root;
}

function buildMenu() {
  const root = document.createElement('div');
  root.className = 'bg-menu';
  root.setAttribute('role', 'menu');
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = `
    <button type="button" class="bg-menu__item" role="menuitem" data-action="blank">
      <span class="bg-menu__icon">${iconBlank()}</span>
      <span class="bg-menu__label">Blank</span>
      <span class="bg-menu__check" aria-hidden="true">${iconCheck()}</span>
    </button>
    <button type="button" class="bg-menu__item" role="menuitem" data-action="add">
      <span class="bg-menu__icon">${iconPlus()}</span>
      <span class="bg-menu__label">Add background image</span>
    </button>
    <button type="button" class="bg-menu__item" role="menuitem" data-action="delete">
      <span class="bg-menu__icon">${iconTrash()}</span>
      <span class="bg-menu__label">Delete current background</span>
    </button>
    <button type="button" class="bg-menu__item" role="menuitem" data-action="shuffle">
      <span class="bg-menu__icon">${iconShuffle()}</span>
      <span class="bg-menu__label">Daily Shuffle</span>
      <span class="bg-menu__check" aria-hidden="true">${iconCheck()}</span>
    </button>
    <button type="button" class="bg-menu__item" role="menuitem" data-action="gallery">
      <span class="bg-menu__icon">${iconGrid()}</span>
      <span class="bg-menu__label">Gallery</span>
    </button>
  `;
  root.addEventListener('click', (evt) => {
    const btn = evt.target.closest('.bg-menu__item');
    if (!btn) return;
    handleMenuAction(btn.dataset.action);
  });
  return root;
}

function buildFileInput() {
  const el = document.createElement('input');
  el.type = 'file';
  el.accept = ACCEPT_MIME;
  el.className = 'bg-controls__file';
  Object.assign(el.style, {
    position: 'fixed', width: '1px', height: '1px',
    opacity: '0', pointerEvents: 'none', overflow: 'hidden',
    clip: 'rect(0 0 0 0)',
  });
  el.addEventListener('change', async () => {
    const file = el.files?.[0];
    el.value = '';
    if (!file) return;
    try { await handleUploadedFile(file); }
    catch (err) { console.error('Background upload failed:', err); }
  });
  return el;
}

// ---------------------------------------------------------------- discovery + refresh ---

async function discoverBuiltins() {
  const out = [];
  let misses = 0;
  for (let i = 0; i < MAX_PROBE && misses < MISS_RUN_LIMIT; i++) {
    const num = String(i).padStart(2, '0');
    const url = `/backgrounds/background_${num}.webp`;
    let exists = false;
    try {
      const resp = await fetch(url, { method: 'HEAD', cache: 'no-cache' });
      const ctype = resp.headers.get('content-type') ?? '';
      exists = resp.ok && ctype.startsWith('image/');
    } catch { exists = false; }
    if (exists) {
      misses = 0;
      out.push({ id: `builtin:${num}`, kind: 'builtin', url, name: `Background ${num}` });
    } else {
      misses++;
    }
  }
  return out;
}

async function refresh() {
  const [builtins, userRows] = await Promise.all([
    discoverBuiltins(),
    getAllUserBackgrounds(),
  ]);

  const userEntries = userRows.map((row) => {
    let url = objectUrls.get(row.id);
    if (!url) {
      url = URL.createObjectURL(row.blob);
      objectUrls.set(row.id, url);
    }
    return { id: row.id, kind: 'user', url, name: row.name };
  });

  const all = [...builtins, ...userEntries].filter((img) => !hiddenIds.has(img.id));

  // Apply user-defined order: ids in `orderIds` come first in their order;
  // any leftover ids (newly added / never reordered) keep their natural order.
  const byId = new Map(all.map((i) => [i.id, i]));
  const ordered = [];
  for (const id of orderIds) {
    const img = byId.get(id);
    if (img) {
      ordered.push(img);
      byId.delete(id);
    }
  }
  for (const img of all) {
    if (byId.has(img.id)) {
      ordered.push(img);
      byId.delete(img.id);
    }
  }
  images = ordered;

  // Revoke object URLs no longer needed.
  const liveIds = new Set(images.map((i) => i.id));
  for (const [id, url] of [...objectUrls.entries()]) {
    if (!liveIds.has(id)) {
      URL.revokeObjectURL(url);
      objectUrls.delete(id);
    }
  }
}

// ---------------------------------------------------------------- apply / cycle ---

function effectiveIndex() {
  if (mode === 'blank' || images.length === 0) return null;
  if (mode === 'shuffle') return shuffleIndexForToday();
  return Math.min(Math.max(0, currentIdx), images.length - 1);
}

function shuffleIndexForToday() {
  if (images.length === 0) return 0;
  const d = new Date();
  const seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  // Knuth multiplicative hash → spread the daily change across the range.
  const h = ((seed * 2654435761) >>> 0) % images.length;
  return h;
}

function getCurrent() {
  const idx = effectiveIndex();
  return idx == null ? null : images[idx];
}

async function applyCurrent({ instant = false } = {}) {
  const cur = getCurrent();
  if (!cur) {
    layerA.classList.remove('is-visible');
    layerB.classList.remove('is-visible');
    return;
  }
  try { await preload(cur.url); }
  catch (err) { console.warn('Background preload failed:', err); }

  const incoming = activeLayer === 'a' ? layerB : layerA;
  const outgoing = activeLayer === 'a' ? layerA : layerB;
  incoming.style.backgroundImage = `url(${JSON.stringify(cur.url)})`;
  if (instant) {
    incoming.style.transition = 'none';
    incoming.classList.add('is-visible');
    outgoing.classList.remove('is-visible');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      incoming.style.transition = '';
    }));
  } else {
    incoming.classList.add('is-visible');
    outgoing.classList.remove('is-visible');
  }
  activeLayer = activeLayer === 'a' ? 'b' : 'a';
}

function preload(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = url;
  });
}

async function cycle(delta) {
  if (mode === 'blank' || images.length === 0) return;
  // Cycling out of shuffle puts the user back in manual control — the day's
  // shuffle pick was just a starting point; once they click prev/next they
  // probably want explicit selection, not for the next applyCurrent to
  // snap back to the daily index.
  if (mode === 'shuffle') {
    mode = 'manual';
    await setPref(PREF_MODE, mode);
  }
  currentIdx = (effectiveIndex() + delta + images.length) % images.length;
  await persistIndex();
  updateControlsVisibility();
  await applyCurrent();
}

async function persistIndex() {
  try { await setPref(PREF_INDEX, currentIdx); } catch {}
}

// ---------------------------------------------------------------- menu actions ---

function toggleMenu() {
  if (menuPopup.classList.contains('is-open')) {
    closeMenu();
  } else {
    openMenu();
  }
}

function openMenu() {
  // Position above the menu button, right-aligned to it.
  const rect = menuBtn.getBoundingClientRect();
  // Render first so we can measure the popup's height.
  menuPopup.classList.add('is-measuring');
  menuPopup.classList.add('is-open');
  menuPopup.style.right = (window.innerWidth - rect.right) + 'px';
  // Show 8 px above the button's top edge.
  menuPopup.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
  menuPopup.classList.remove('is-measuring');
  menuBtn.setAttribute('aria-expanded', 'true');
  menuPopup.setAttribute('aria-hidden', 'false');
  refreshMenuStates();
}

function closeMenu() {
  menuPopup.classList.remove('is-open');
  menuBtn.setAttribute('aria-expanded', 'false');
  menuPopup.setAttribute('aria-hidden', 'true');
  menuBtn.blur();
}

function refreshMenuStates() {
  // Toggle check marks + disabled states.
  menuPopup.querySelectorAll('.bg-menu__item').forEach((btn) => {
    const action = btn.dataset.action;
    btn.classList.remove('is-active', 'is-disabled');
    if (action === 'blank' && mode === 'blank') btn.classList.add('is-active');
    if (action === 'shuffle' && mode === 'shuffle') btn.classList.add('is-active');
    if (action === 'delete' && !getCurrent()) btn.classList.add('is-disabled');
  });
}

async function handleMenuAction(action) {
  closeMenu();
  switch (action) {
    case 'blank':       return setMode(mode === 'blank' ? 'manual' : 'blank');
    case 'add':         return fileInputEl?.click();
    case 'delete':      return deleteCurrentBackground();
    case 'shuffle':     return setMode(mode === 'shuffle' ? 'manual' : 'shuffle');
    case 'gallery':     return openGallery();
  }
}

// ---------------------------------------------------------------- mode + actions ---

async function setMode(next) {
  if (mode === next) return;
  mode = next;
  await setPref(PREF_MODE, mode);
  if (mode === 'shuffle') scheduleNextMidnight();
  updateControlsVisibility();
  await applyCurrent();
}

async function deleteCurrentBackground() {
  const cur = getCurrent();
  if (!cur) return;
  if (cur.kind === 'user') {
    await deleteUserBackground(cur.id);
  }
  // For BOTH user and builtin, also add to the hidden set so the local
  // user never sees it again (until they clear browser data). User images
  // are gone from IDB; builtins remain on disk but are filtered out.
  hiddenIds.add(cur.id);
  await setPref(PREF_HIDDEN, [...hiddenIds]);

  await refresh();
  if (images.length === 0) {
    mode = 'blank';
    await setPref(PREF_MODE, mode);
  } else if (mode === 'manual') {
    // Keep pointing at "roughly where we were": if we deleted the last item,
    // wrap to 0; otherwise stay on the same index so the next image fills in.
    if (currentIdx >= images.length) currentIdx = 0;
    await persistIndex();
  }
  updateControlsVisibility();
  await applyCurrent();
  if (gallery.isOpen()) gallery.render(images, getCurrent()?.id);
}

async function deleteImageById(id) {
  const img = images.find((i) => i.id === id);
  if (!img) return;
  if (img.kind === 'user') {
    await deleteUserBackground(id);
  }
  hiddenIds.add(id);
  await setPref(PREF_HIDDEN, [...hiddenIds]);
  await refresh();
  if (currentIdx >= images.length) currentIdx = Math.max(0, images.length - 1);
  await persistIndex();
  if (images.length === 0 && mode !== 'blank') {
    mode = 'blank';
    await setPref(PREF_MODE, mode);
  }
  updateControlsVisibility();
  await applyCurrent();
  if (gallery.isOpen()) gallery.render(images, getCurrent()?.id);
}

async function selectImageById(id) {
  const idx = images.findIndex((i) => i.id === id);
  if (idx === -1) return;
  if (mode !== 'manual') {
    mode = 'manual';
    await setPref(PREF_MODE, mode);
  }
  currentIdx = idx;
  await persistIndex();
  updateControlsVisibility();
  await applyCurrent();
  if (gallery.isOpen()) gallery.render(images, getCurrent()?.id);
}

async function handleReorder(srcId, targetId, position) {
  const srcIdx = images.findIndex((i) => i.id === srcId);
  const targetIdx = images.findIndex((i) => i.id === targetId);
  if (srcIdx === -1 || targetIdx === -1) return;

  const next = images.slice();
  const [moved] = next.splice(srcIdx, 1);
  const adjTarget = next.findIndex((i) => i.id === targetId);
  next.splice(position === 'before' ? adjTarget : adjTarget + 1, 0, moved);

  // Persist the full new order, plus any ids the user hasn't explicitly
  // ordered yet (so they don't get re-shuffled to the bottom on refresh).
  orderIds = next.map((i) => i.id);
  await setPref(PREF_ORDER, orderIds);

  // Keep currentIdx pointing at the same image, not the same slot.
  const currentId = getCurrent()?.id;
  await refresh();
  if (currentId) {
    const newIdx = images.findIndex((i) => i.id === currentId);
    if (newIdx !== -1) currentIdx = newIdx;
    await persistIndex();
  }
  if (gallery.isOpen()) gallery.render(images, getCurrent()?.id);
}

// ---------------------------------------------------------------- upload ---

async function handleUploadedFile(file) {
  if (!file.type.startsWith('image/')) {
    console.warn('Background upload rejected — not an image:', file.type);
    return;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    console.warn(`Background upload rejected — too large (${file.size} bytes).`);
    return;
  }
  const id = `user:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await putUserBackground({
    id, name: file.name || 'Custom background',
    blob: file, mimeType: file.type, addedAt: Date.now(),
  });
  await refresh();

  // Jump to the just-uploaded image and switch out of blank/shuffle so the
  // user sees their upload immediately.
  if (mode !== 'manual') {
    mode = 'manual';
    await setPref(PREF_MODE, mode);
  }
  const idx = images.findIndex((i) => i.id === id);
  if (idx !== -1) {
    currentIdx = idx;
    await persistIndex();
  }
  updateControlsVisibility();
  await applyCurrent();
  if (gallery.isOpen()) gallery.render(images, getCurrent()?.id);
}

// ---------------------------------------------------------------- visibility ---

function updateControlsVisibility() {
  if (!controlsEl) return;
  controlsEl.classList.toggle('is-blank', mode === 'blank');
  controlsEl.classList.toggle('is-empty', images.length === 0);
}

// ---------------------------------------------------------------- gallery ---

function openGallery() {
  gallery.show();
  gallery.render(images, getCurrent()?.id);
}

// ---------------------------------------------------------------- midnight ---

function scheduleNextMidnight() {
  if (midnightTimer) clearTimeout(midnightTimer);
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
  midnightTimer = setTimeout(() => {
    if (mode === 'shuffle') applyCurrent();
    scheduleNextMidnight();
  }, Math.max(1000, next - now));
}

// ---------------------------------------------------------------- global handlers ---

function onDocumentPointerDown(evt) {
  // Close menu if a pointerdown happens outside menu + menu button.
  if (menuPopup?.classList.contains('is-open')) {
    if (!menuPopup.contains(evt.target) && !menuBtn.contains(evt.target)) {
      closeMenu();
    }
  }
}

function onKeyDown(evt) {
  if (evt.key === 'Escape') {
    if (menuPopup?.classList.contains('is-open')) closeMenu();
    else if (gallery?.isOpen()) gallery.hide();
  }
}

// ---------------------------------------------------------------- icon helpers ---

function iconBlank() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
    <rect x="4" y="4" width="16" height="16" rx="2"/>
    <line x1="5" y1="19" x2="19" y2="5"/>
  </svg>`;
}
function iconPlus() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
    <path d="M12 5v14M5 12h14"/>
  </svg>`;
}
function iconTrash() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/>
  </svg>`;
}
function iconShuffle() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <polyline points="16 3 21 3 21 8"/>
    <line x1="4" y1="20" x2="21" y2="3"/>
    <polyline points="21 16 21 21 16 21"/>
    <line x1="15" y1="15" x2="21" y2="21"/>
    <line x1="4" y1="4" x2="9" y2="9"/>
  </svg>`;
}
function iconGrid() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="7" height="7" rx="1"/>
    <rect x="14" y="3" width="7" height="7" rx="1"/>
    <rect x="3" y="14" width="7" height="7" rx="1"/>
    <rect x="14" y="14" width="7" height="7" rx="1"/>
  </svg>`;
}
function iconCheck() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <polyline points="5 12 10 17 19 7"/>
  </svg>`;
}
