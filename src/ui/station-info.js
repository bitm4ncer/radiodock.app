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
import { getStationByUuid, getStationInfo } from '../data/stations-source.js';
import { getLogoUrl } from '../data/logo-resolver.js';
import { SOCIAL_ICONS, SOCIAL_ORDER, SOCIAL_LABELS } from './social-icons.js';
import { detectStandalone } from '../platform.js';
import { isElectron } from './electron-bridge.js';

// Solid utility glyphs (Heroicons solid) so they read at the same weight as
// the filled brand marks in the same row.
const ICON_GLOBE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M21.7214 12.7517C21.7404 12.5036 21.75 12.2529 21.75 11.9999C21.75 10.4758 21.4003 9.03328 20.7767 7.74835C19.5396 8.92269 18.0671 9.85146 16.4374 10.4565C16.4789 10.9655 16.5 11.4803 16.5 11.9999C16.5 13.1011 16.4051 14.1802 16.2229 15.2293C18.2163 14.7277 20.0717 13.8792 21.7214 12.7517Z"/><path d="M14.6343 15.5501C14.874 14.4043 15 13.2168 15 11.9999C15 11.6315 14.9885 11.2659 14.9657 10.9032C14.0141 11.1299 13.021 11.2499 12 11.2499C10.979 11.2499 9.98594 11.1299 9.0343 10.9032C9.01155 11.2659 9 11.6315 9 11.9999C9 13.2168 9.12601 14.4043 9.3657 15.5501C10.2246 15.6817 11.1043 15.7499 12 15.7499C12.8957 15.7499 13.7754 15.6817 14.6343 15.5501Z"/><path d="M9.77224 17.119C10.5028 17.2054 11.2462 17.2499 12 17.2499C12.7538 17.2499 13.4972 17.2054 14.2278 17.119C13.714 18.7746 12.9575 20.3235 12 21.724C11.0425 20.3235 10.286 18.7746 9.77224 17.119Z"/><path d="M7.77705 15.2293C7.59493 14.1802 7.5 13.1011 7.5 11.9999C7.5 11.4803 7.52114 10.9655 7.56261 10.4565C5.93286 9.85146 4.46039 8.92269 3.22333 7.74835C2.59973 9.03328 2.25 10.4758 2.25 11.9999C2.25 12.2529 2.25964 12.5036 2.27856 12.7517C3.92826 13.8792 5.78374 14.7277 7.77705 15.2293Z"/><path d="M21.3561 14.7525C20.3404 18.2104 17.4597 20.8705 13.8776 21.5693C14.744 20.1123 15.4185 18.5278 15.8664 16.8508C17.8263 16.44 19.6736 15.7231 21.3561 14.7525Z"/><path d="M2.64395 14.7525C4.32642 15.7231 6.17372 16.44 8.13356 16.8508C8.58146 18.5278 9.25602 20.1123 10.1224 21.5693C6.54027 20.8705 3.65964 18.2104 2.64395 14.7525Z"/><path d="M13.8776 2.43055C16.3991 2.92245 18.5731 4.3862 19.9937 6.41599C18.9351 7.48484 17.6637 8.34251 16.2483 8.92017C15.862 6.58282 15.0435 4.39132 13.8776 2.43055Z"/><path d="M12 2.27588C13.4287 4.36548 14.4097 6.78537 14.805 9.39744C13.9083 9.62756 12.9684 9.74993 12 9.74993C11.0316 9.74993 10.0917 9.62756 9.19503 9.39744C9.5903 6.78537 10.5713 4.36548 12 2.27588Z"/><path d="M10.1224 2.43055C8.95648 4.39132 8.13795 6.58282 7.75171 8.92017C6.33629 8.34251 5.06489 7.48484 4.00635 6.41599C5.42689 4.3862 7.60085 2.92245 10.1224 2.43055Z"/></svg>';
const ICON_COPY = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M7.5 3.375C7.5 2.33947 8.33947 1.5 9.375 1.5H9.75C11.8211 1.5 13.5 3.17893 13.5 5.25V7.125C13.5 8.16053 14.3395 9 15.375 9H17.25C19.3211 9 21 10.6789 21 12.75V16.125C21 17.1605 20.1605 18 19.125 18H9.375C8.33947 18 7.5 17.1605 7.5 16.125V3.375Z"/><path d="M15 5.25C15 3.93695 14.518 2.73648 13.7212 1.8159C17.1201 2.70377 19.7962 5.37988 20.6841 8.77881C19.7635 7.98204 18.5631 7.5 17.25 7.5H15.375C15.1679 7.5 15 7.33211 15 7.125V5.25Z"/><path d="M4.875 6H6V16.125C6 17.989 7.51104 19.5 9.375 19.5H16.5V20.625C16.5 21.6605 15.6605 22.5 14.625 22.5H4.875C3.83947 22.5 3 21.6605 3 20.625V7.875C3 6.83947 3.83947 6 4.875 6Z"/></svg>';
const ICON_CHECK = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M19.916 4.62592C20.2607 4.85568 20.3538 5.32134 20.124 5.66598L11.124 19.166C10.9994 19.3529 10.7975 19.4742 10.5739 19.4963C10.3503 19.5184 10.1286 19.4392 9.96967 19.2803L3.96967 13.2803C3.67678 12.9874 3.67678 12.5125 3.96967 12.2196C4.26256 11.9267 4.73744 11.9267 5.03033 12.2196L10.3834 17.5727L18.876 4.83393C19.1057 4.48929 19.5714 4.39616 19.916 4.62592Z"/></svg>';
const ICON_MAIL = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M1.5 8.6691V17.25C1.5 18.9069 2.84315 20.25 4.5 20.25H19.5C21.1569 20.25 22.5 18.9069 22.5 17.25V8.6691L13.5723 14.1631C12.6081 14.7564 11.3919 14.7564 10.4277 14.1631L1.5 8.6691Z"/><path d="M22.5 6.90783V6.75C22.5 5.09315 21.1569 3.75 19.5 3.75H4.5C2.84315 3.75 1.5 5.09315 1.5 6.75V6.90783L11.2139 12.8856C11.696 13.1823 12.304 13.1823 12.7861 12.8856L22.5 6.90783Z"/></svg>';
const ICON_DRAG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>';
const ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const ICON_ARROW_DOWN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function getInitials(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || name[0]?.toUpperCase() || '?';
}

function streamKind(url) {
  if (!url) return '—';
  if (/\.m3u8(\?|$)/i.test(url)) return 'HLS';
  return 'ICY / HTTP';
}

export function mountStationInfo() {
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

  function render(station, { full, wiki, wikiLoading, fullLoading }) {
    const data = { ...station, ...(full ?? {}) };
    const tags = Array.isArray(data.tags) ? data.tags.filter(Boolean).slice(0, 8) : [];

    const tagsHtml = tags.length
      ? `<div class="station-info__tags">${tags.map((t) => `<span class="station-info__tag">${escapeHtml(t)}</span>`).join('')}</div>`
      : '';

    // Location line — flag + country code + city — directly under the name.
    const cc = String(data.countrycode ?? '').trim();
    const flag = cc
      ? `<img class="station-info__flag" src="https://flagcdn.com/${escapeHtml(cc.toLowerCase())}.svg" alt="" onerror="this.remove()">`
      : '';
    const locParts = [];
    if (cc) locParts.push(cc.toUpperCase());
    if (data.city) locParts.push(data.city);
    const locationHtml = (flag || locParts.length)
      ? `<div class="station-info__location">${flag}<span>${escapeHtml(locParts.join(', '))}</span></div>`
      : '';

    // Links row: social platforms + website + copy-stream-URL + contact, all
    // rendered as the same round chip.
    const socials = Array.isArray(data.socials) ? data.socials : [];
    const linkChips = SOCIAL_ORDER
      .map((p) => socials.find((s) => s.platform === p))
      .filter(Boolean)
      .map((s) => `<a class="station-info__social" href="${escapeHtml(s.url)}" target="_blank" rel="noopener" title="${escapeHtml(SOCIAL_LABELS[s.platform] ?? s.platform)}" aria-label="${escapeHtml(SOCIAL_LABELS[s.platform] ?? s.platform)}">${SOCIAL_ICONS[s.platform] ?? ''}</a>`);
    if (data.homepage) {
      linkChips.push(`<a class="station-info__social" href="${escapeHtml(data.homepage)}" target="_blank" rel="noopener" title="Website" aria-label="Website">${ICON_GLOBE}</a>`);
    }
    linkChips.push(`<button type="button" class="station-info__social" data-action="copy-url" data-url="${escapeHtml(data.url ?? '')}" title="Copy stream URL" aria-label="Copy stream URL">${ICON_COPY}</button>`);
    if (data.contactEmail) {
      linkChips.push(`<a class="station-info__social" href="mailto:${escapeHtml(data.contactEmail)}" title="Contact" aria-label="Contact">${ICON_MAIL}</a>`);
    }
    const linksHtml = linkChips.length ? `<div class="station-info__socials">${linkChips.join('')}</div>` : '';

    // A station's own curated description wins over the Wikipedia fallback.
    const curatedInfo = typeof data.info === 'string' ? data.info.trim() : '';
    const aboutInner = curatedInfo
      ? `<p class="station-info__about">${escapeHtml(curatedInfo)}</p>`
      : wiki
        ? `<p class="station-info__about">${escapeHtml(wiki.extract)}</p>
           <p class="station-info__source">
             via <a href="${escapeHtml(wiki.url)}" target="_blank" rel="noopener">Wikipedia: ${escapeHtml(wiki.title)} →</a>
           </p>`
        : (fullLoading || wikiLoading)
          ? `<p class="station-info__loading">Loading…</p>`
          : '';
    const aboutBlock = aboutInner
      ? `<section class="station-info__section"><h4>About</h4>${aboutInner}</section>`
      : '';

    const streamRows = [];
    streamRows.push(['Format', streamKind(data.url)]);
    if (data.codec) streamRows.push(['Codec', data.codec.toUpperCase()]);
    if (data.bitrate) streamRows.push(['Bitrate', `${data.bitrate} kbps`]);

    const streamHtml = `
      <section class="station-info__section">
        <h4>Stream</h4>
        <dl class="station-info__stream">
          ${streamRows.map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}
        </dl>
      </section>`;

    // The logo + name are dropped — the player pill (which rises with the
    // sheet, and is always on screen on desktop) already shows them. Location
    // sits directly above the socials; tags move to the bottom under Stream.
    const topGroup = (locationHtml || linksHtml)
      ? `<div class="station-info__top">${locationHtml}${linksHtml}</div>`
      : '';

    return `
      ${topGroup}
      ${aboutBlock}
      ${streamHtml}
      ${tagsHtml}
    `;
  }

  // Delegated action clicks inside the body.
  bodyEl.addEventListener('click', async (evt) => {
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

  panel.querySelector('[data-action="close"]').addEventListener('click', () => close());

  // ---- Open / close ----------------------------------------------------

  function open(station) {
    if (!station) return;
    const token = ++openToken;
    if (titleEl) titleEl.textContent = station.name ?? 'Station';
    bodyEl.innerHTML = render(station, { full: null, wiki: null, wikiLoading: true, fullLoading: true });
    if (!isOpen) showPanel();

    const isCustom = String(station.id ?? '').startsWith('custom-');
    const fullPromise = isCustom
      ? Promise.resolve(null)
      : getStationInfo(station.id)
          .then((info) => info ?? getStationByUuid(station.id).catch(() => null))
          .catch(() => getStationByUuid(station.id).catch(() => null));
    const wikiPromise = fetchStationInfo(station.name).catch(() => null);

    fullPromise.then((full) => {
      if (token !== openToken) return;
      bodyEl.innerHTML = render(station, { full, wiki: null, wikiLoading: true, fullLoading: false });
    });

    Promise.all([fullPromise, wikiPromise]).then(([full, wiki]) => {
      if (token !== openToken) return;
      bodyEl.innerHTML = render(station, { full, wiki, wikiLoading: false, fullLoading: false });
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
    const handle = panel.querySelector('[data-role="drag"]');
    let dragging = false, pointerId = null, offX = 0, offY = 0;
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const rect = panel.getBoundingClientRect();
      dragging = true; pointerId = e.pointerId;
      handle.setPointerCapture(pointerId);
      offX = e.clientX - rect.left; offY = e.clientY - rect.top;
      panel.classList.add('is-dragging');
      e.preventDefault();
    });
    handle.addEventListener('pointermove', (e) => {
      if (!dragging || e.pointerId !== pointerId) return;
      applyDesktopPos(e.clientX - offX, e.clientY - offY);
    });
    const end = (e) => {
      if (!dragging || (e && e.pointerId !== pointerId)) return;
      dragging = false; panel.classList.remove('is-dragging');
      try { handle.releasePointerCapture(pointerId); } catch {}
      pointerId = null;
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  return { open, close, isOpen: () => isOpen };
}
