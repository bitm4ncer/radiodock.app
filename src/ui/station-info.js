// Station info panel. Two presentations of one shared instance:
//   - Desktop browser: a floating, drag-positioned panel (like the notes
//     panel). Re-triggering the ⓘ on another station just swaps its content.
//   - Mobile / PWA / desktop app: a sheet that slides up from the bottom to
//     sit under the action bar while the player rises to pin under the header.
//     Opens via the ⓘ button or a swipe-up on the player; closes via the
//     arrow-down button or a swipe-down on the sheet.
//
// Data (unchanged): the seed station object + our consolidated endpoint
// (getStationInfo — curated info/tags/city/socials/contact) with a Radio
// Browser by-uuid fallback, plus a Wikipedia summary. A station's own curated
// `info` always wins over the Wikipedia fallback.

import { fetchStationInfo } from '../data/wikipedia.js';
import { loadDiscover } from '../data/discover.js';
import { getStationByUuid, getStationInfo } from '../data/stations-source.js';
import { renderStationInfo, ICON_CHECK } from './station-info-render.js';
import { openStationEdit } from './station-edit.js';
import { detectStandalone } from '../platform.js';
import { isElectron } from './electron-bridge.js';
import { registerSnapSurface, snapPanel, cancelSnap } from './panel-snap.js';

// Solid utility glyphs (Heroicons solid) so they read at the same weight as
// the filled brand marks in the same row.
const ICON_DRAG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>';
const ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const ICON_ARROW_DOWN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

function collectionsForStation(data, station) {
  const id = String(station?.id ?? '').trim();
  if (!id) return [];
  const lists = Array.isArray(data?.curated?.lists) ? data.curated.lists : [];
  const seen = new Set();
  const result = [];
  for (const list of lists) {
    const slug = String(list?.slug ?? '').trim();
    const title = String(list?.title ?? '').trim();
    if (!slug || !title || seen.has(slug) || !Array.isArray(list.stations)) continue;
    if (list.stations.some((entry) => String(entry?.stationuuid ?? '') === id)) {
      seen.add(slug);
      result.push({ slug, title });
    }
  }
  return result;
}


// Shared click handling for the info body (bottom sheet and inline row
// section): copy the stream URL, or open the community edit form.
export function wireStationInfoActions(root, { getStation = () => null, getFull = () => null, onOpenCollection = null } = {}) {
  root.addEventListener('click', async (evt) => {
    const collectionButton = evt.target.closest('[data-action="open-collection"]');
    if (collectionButton) {
      const slug = collectionButton.dataset.slug;
      if (slug) onOpenCollection?.(slug);
      return;
    }
    if (evt.target.closest('[data-action="edit"]')) {
      openStationEdit(getStation(), getFull());
      return;
    }
    const action = evt.target.closest('[data-action="copy-url"]');
    if (!action) return;
    const url = action.dataset.url;
    if (!url) return;
    try { await navigator.clipboard.writeText(url); } catch {}
    const prev = action.innerHTML;
    action.innerHTML = ICON_CHECK;
    action.classList.add('is-copied');
    setTimeout(() => { action.innerHTML = prev; action.classList.remove('is-copied'); }, 1400);
  });
}

export function mountStationInfo({ onOpenCollection = null } = {}) {
  // Structural mode follows the layout regime (matches pagesAreExclusive in
  // main.js): narrow viewport, installed PWA, or Electron → the slide-up sheet;
  // a regular desktop browser → the floating draggable panel.
  const appMode = matchMedia('(max-width: 699px)').matches || detectStandalone() || isElectron();

  const panel = document.createElement('aside');
  panel.className = 'info-panel ' + (appMode ? 'info-panel--sheet' : 'info-panel--desktop');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Station info');
  panel.setAttribute('aria-hidden', 'true');
  // Desktop keeps a header bar (drag handle + ×). The sheet drops the bar
  // entirely to save vertical space — the arrow-down floats into the top-right
  // of the content, indented to the content padding.
  panel.innerHTML = appMode
    ? `
      <button type="button" class="info-panel__icon-btn info-panel__close-float" data-action="close" aria-label="Close">${ICON_ARROW_DOWN}</button>
      <div class="info-panel__body station-info-body" data-role="body"></div>
    `
    : `
      <header class="info-panel__header" data-role="header">
        <span class="info-panel__drag" data-role="drag" title="Drag" aria-hidden="true">${ICON_DRAG}</span>
        <span class="info-panel__title" data-role="title"></span>
        <span class="info-panel__spacer"></span>
        <button type="button" class="info-panel__icon-btn" data-action="close" aria-label="Close">${ICON_CLOSE}</button>
      </header>
      <div class="info-panel__body station-info-body" data-role="body"></div>
    `;
  document.body.appendChild(panel);

  const bodyEl = panel.querySelector('[data-role="body"]');
  const titleEl = panel.querySelector('[data-role="title"]'); // desktop header only
  let isOpen = false;
  let openToken = 0;
  // Desktop drag position kept in-memory for the session (survives content
  // swaps and re-opens); resets on reload.
  let deskPos = null;

  // Latest station + consolidated payload, so the edit form opens pre-filled.
  let currentStation = null;
  let currentFull = null;
  let currentWiki = null;
  let currentCollections = [];
  let fullLoading = true;
  let wikiLoading = true;

  function paint() {
    if (!currentStation) return;
    bodyEl.innerHTML = renderStationInfo(currentStation, {
      full: currentFull,
      wiki: currentWiki,
      wikiLoading,
      fullLoading,
      collections: currentCollections,
    });
  }

  // Delegated action clicks inside the body.
  wireStationInfoActions(bodyEl, {
    getStation: () => currentStation,
    getFull: () => currentFull,
    onOpenCollection,
  });

  panel.querySelector('[data-action="close"]').addEventListener('click', () => close());

  // ---- Open / close ----------------------------------------------------

  function open(station) {
    if (!station) return;
    const token = ++openToken;
    currentStation = station;
    currentFull = null;
    currentWiki = null;
    currentCollections = [];
    fullLoading = true;
    wikiLoading = true;
    if (titleEl) titleEl.textContent = station.name ?? 'Station';
    paint();
    if (!isOpen) showPanel();

    const isCustom = String(station.id ?? '').startsWith('custom-');
    const fullPromise = isCustom
      ? Promise.resolve(null)
      : getStationInfo(station.id)
          .then((info) => info ?? getStationByUuid(station.id).catch(() => null))
          .catch(() => getStationByUuid(station.id).catch(() => null));
    const wikiPromise = fetchStationInfo(station.name).catch(() => null);
    const collectionsPromise = loadDiscover({})
      .then((data) => collectionsForStation(data, station))
      .catch(() => []);

    fullPromise.then((full) => {
      if (token !== openToken) return;
      currentFull = full ?? currentFull;
      fullLoading = false;
      paint();
    });

    wikiPromise.then((wiki) => {
      if (token !== openToken) return;
      currentWiki = wiki ?? null;
      wikiLoading = false;
      paint();
    });

    collectionsPromise.then((collections) => {
      if (token !== openToken) return;
      currentCollections = collections;
      paint();
    });
  }

  function showPanel() {
    isOpen = true;
    panel.setAttribute('aria-hidden', 'false');
    // Transient dialog — coexists with the notes/desktop panels, so it does
    // NOT fire rd:page-open. (Matches the previous modal behaviour.)
    if (appMode) enterSheet();
    else { positionDesktop(); panel.classList.add('is-open'); }
  }

  function close() {
    if (!isOpen) return;
    cancelSnap(panel);
    isOpen = false;
    panel.setAttribute('aria-hidden', 'true');
    if (appMode) exitSheet();
    else panel.classList.remove('is-open');
  }

  // ---- Mobile sheet ----------------------------------------------------

  function measureSheet() {
    const topbar = document.querySelector('.mobile-topbar');
    const ps = document.querySelector('.player-section');
    if (!ps) return;
    // The top bar is never transformed, so its rect is stable.
    const tbBottom = topbar ? Math.round(topbar.getBoundingClientRect().bottom) : 0;
    // Use the player's LAYOUT height + its fixed bottom:0 resting position
    // instead of its live rect — a shift computed while the player is still
    // mid-animation (e.g. re-opening right after a close) would otherwise be
    // wrong. Resting top = viewport height − layout height.
    const h = ps.offsetHeight;
    const restingTop = window.innerHeight - h;
    // Rise the player so its top edge meets the header bottom.
    ps.style.setProperty('--info-player-shift', `${Math.round(tbBottom - restingTop)}px`);
    // The sheet rests directly under the risen player.
    document.body.style.setProperty('--info-sheet-top', `${Math.round(tbBottom + h)}px`);
  }

  function enterSheet() {
    // Add the class first so the player's reduced info-open padding is in
    // effect before we measure its height (keeps the sheet flush).
    document.body.classList.add('info-open');
    measureSheet();
    panel.classList.add('is-open');
  }

  function exitSheet() {
    document.body.classList.remove('info-open');
    panel.classList.remove('is-open');
  }

  // Keep the geometry correct across rotation / resize while open.
  window.addEventListener('resize', () => { if (isOpen && appMode) measureSheet(); });

  // Swipe-down anywhere on the sheet closes it.
  if (appMode) {
    let sy = 0, sx = 0, tracking = false;
    panel.addEventListener('pointerdown', (e) => {
      // Don't start a close-drag from a link/button inside the body.
      if (e.target.closest('a, button')) { tracking = false; return; }
      sy = e.clientY; sx = e.clientX; tracking = true;
    });
    panel.addEventListener('pointerup', (e) => {
      if (!tracking) return;
      tracking = false;
      const dy = e.clientY - sy, dx = e.clientX - sx;
      if (dy > 60 && Math.abs(dy) > Math.abs(dx)) close();
    });
  }

  // ---- Desktop drag ----------------------------------------------------

  function positionDesktop() {
    const w = 360, margin = 24;
    if (!deskPos) {
      deskPos = { x: Math.max(margin, window.innerWidth - w - margin), y: 84 };
    }
    applyDesktopPos(deskPos.x, deskPos.y);
  }

  function applyDesktopPos(x, y) {
    const rect = panel.getBoundingClientRect();
    const w = rect.width || 360;
    const h = rect.height || 420;
    const cx = Math.max(8, Math.min(window.innerWidth - w - 8, x));
    const cy = Math.max(8, Math.min(window.innerHeight - h - 8, y));
    deskPos = { x: cx, y: cy };
    panel.style.setProperty('--info-x', cx + 'px');
    panel.style.setProperty('--info-y', cy + 'px');
    panel.classList.add('is-positioned');
  }

  if (!appMode) {
    // The info panel joins the same snap surface as Notes / Stations / Add /
    // Sync. Its position stays session-only; the adapter lets a neighbour
    // insertion move it during the same spring animation.
    registerSnapSurface(panel, { setPosition: applyDesktopPos });
    const handle = panel.querySelector('[data-role="drag"]');
    let dragging = false, pointerId = null, offX = 0, offY = 0;
    const startDrag = (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('button, a, input, textarea, select')) return;
      cancelSnap(panel);
      const rect = panel.getBoundingClientRect();
      dragging = true; pointerId = e.pointerId;
      handle.setPointerCapture(pointerId);
      offX = e.clientX - rect.left; offY = e.clientY - rect.top;
      panel.classList.add('is-dragging');
      e.preventDefault();
    };
    // The whole header is the grab area, like the notes / stations / add /
    // sync panels; the six-dot glyph stays as the visual affordance.
    const dragArea = panel.querySelector('.info-panel__header') ?? handle;
    dragArea.addEventListener('pointerdown', startDrag);
    handle.addEventListener('pointermove', (e) => {
      if (!dragging || e.pointerId !== pointerId) return;
      applyDesktopPos(e.clientX - offX, e.clientY - offY);
    });
    const end = (e) => {
      if (!dragging || (e && e.pointerId !== pointerId)) return;
      dragging = false; panel.classList.remove('is-dragging');
      try { handle.releasePointerCapture(pointerId); } catch {}
      pointerId = null;
      const rect = panel.getBoundingClientRect();
      snapPanel(panel, { x: rect.left, y: rect.top, setPosition: applyDesktopPos });
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  return { open, close, isOpen: () => isOpen };
}
