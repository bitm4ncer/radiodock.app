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

const ICON_HOME = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4"/></svg>';
const ICON_COPY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 13l4 4L19 7"/></svg>';
const ICON_MAIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>';
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
  panel.innerHTML = `
    <header class="info-panel__header" data-role="header">
      ${appMode ? '' : `<span class="info-panel__drag" data-role="drag" title="Drag" aria-hidden="true">${ICON_DRAG}</span>`}
      <span class="info-panel__title" data-role="title">Station</span>
      <span class="info-panel__spacer"></span>
      <button type="button" class="info-panel__icon-btn" data-action="close" aria-label="Close">${appMode ? ICON_ARROW_DOWN : ICON_CLOSE}</button>
    </header>
    <div class="info-panel__body station-info-body" data-role="body"></div>
  `;
  document.body.appendChild(panel);

  const bodyEl = panel.querySelector('[data-role="body"]');
  const titleEl = panel.querySelector('[data-role="title"]');
  let isOpen = false;
  let openToken = 0;
  // Desktop drag position kept in-memory for the session (survives content
  // swaps and re-opens); resets on reload.
  let deskPos = null;

  function render(station, { full, wiki, wikiLoading, fullLoading }) {
    const data = { ...station, ...(full ?? {}) };
    const initials = getInitials(data.name);
    const tags = Array.isArray(data.tags) ? data.tags.filter(Boolean).slice(0, 8) : [];

    const logoUrl = getLogoUrl(data, 512);
    const heroImage = wiki?.thumbnail
      ? `<img class="station-info__hero" src="${escapeHtml(wiki.thumbnail)}" alt="">`
      : logoUrl
        ? `<img class="station-info__logo" src="${escapeHtml(logoUrl)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'station-info__initials',textContent:${JSON.stringify(initials)}}))">`
        : `<div class="station-info__initials">${escapeHtml(initials)}</div>`;

    const tagsHtml = tags.length
      ? `<div class="station-info__tags">${tags.map((t) => `<span class="station-info__tag">${escapeHtml(t)}</span>`).join('')}</div>`
      : '';

    const socials = Array.isArray(data.socials) ? data.socials : [];
    const socialsHtml = socials.length
      ? `<div class="station-info__socials">
           ${SOCIAL_ORDER
             .map((p) => socials.find((s) => s.platform === p))
             .filter(Boolean)
             .map((s) => `<a class="station-info__social" href="${escapeHtml(s.url)}" target="_blank" rel="noopener" title="${escapeHtml(SOCIAL_LABELS[s.platform] ?? s.platform)}" aria-label="${escapeHtml(SOCIAL_LABELS[s.platform] ?? s.platform)}">${SOCIAL_ICONS[s.platform] ?? ''}</a>`)
             .join('')}
         </div>`
      : '';

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
    if (data.countrycode) streamRows.push(['Country', data.countrycode.toUpperCase()]);
    if (data.city) streamRows.push(['City', data.city]);

    const streamHtml = `
      <section class="station-info__section">
        <h4>Stream</h4>
        <dl class="station-info__stream">
          ${streamRows.map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}
        </dl>
      </section>`;

    const actions = `
      <div class="station-info__actions">
        ${data.homepage
          ? `<a class="station-info__action-icon" href="${escapeHtml(data.homepage)}" target="_blank" rel="noopener" title="Visit homepage" aria-label="Visit homepage">${ICON_HOME}</a>`
          : ''}
        <button type="button" class="station-info__action-icon" data-action="copy-url" data-url="${escapeHtml(data.url ?? '')}" title="Copy stream URL" aria-label="Copy stream URL">${ICON_COPY}</button>
        ${data.contactEmail
          ? `<a class="station-info__action-icon" href="mailto:${escapeHtml(data.contactEmail)}" title="Contact" aria-label="Contact">${ICON_MAIL}</a>`
          : ''}
      </div>`;

    return `
      <header class="station-info__header">
        ${heroImage}
        <div class="station-info__meta">
          <div class="station-info__name">${escapeHtml(data.name ?? '')}</div>
          ${tagsHtml}
        </div>
      </header>
      ${socialsHtml}
      ${aboutBlock}
      ${streamHtml}
      ${actions}
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
    titleEl.textContent = station.name ?? 'Station';
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
    measureSheet();
    document.body.classList.add('info-open');
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
