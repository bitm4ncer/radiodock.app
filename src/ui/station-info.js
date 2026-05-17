// Station info bottom-sheet. Composed of three data sources, all
// gracefully degrading:
//   1. The station object the caller passed in (always available — at
//      minimum: id, name, url, countrycode, favicon, homepage).
//   2. A live Radio Browser by-uuid lookup that adds tags / bitrate /
//      codec / votes / clickcount for Community stations (where the
//      seed JSON only carries the minimal shape).
//   3. A Wikipedia summary lookup that adds a description paragraph
//      and (when available) a thumbnail image — works for famous
//      stations (NTS, FIP, BBC, KEXP, dublab…), silently returns null
//      for niche ones.
//
// Both network calls are fired in parallel and the sheet re-renders
// when either resolves. The skeleton is populated synchronously from
// the seed object so the modal never opens blank.

import { openModal } from './modals.js';
import { fetchStationInfo } from '../data/wikipedia.js';
import { getStationByUuid } from '../data/radio-browser.js';

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

function streamKind(url) {
  if (!url) return '—';
  if (/\.m3u8(\?|$)/i.test(url)) return 'HLS';
  return 'ICY / HTTP';
}

export function mountStationInfo() {
  const modal = document.getElementById('stationInfoModal');
  const body = document.getElementById('stationInfoBody');
  const titleEl = document.getElementById('stationInfoTitle');
  if (!modal || !body || !titleEl) {
    return { open() {} };
  }

  // Delegated click handler for action buttons inside the body (added
  // once; the body's innerHTML is replaced on every open + on data
  // resolve, but the listener on the parent body element survives).
  body.addEventListener('click', async (evt) => {
    const action = evt.target.closest('[data-action]');
    if (!action) return;
    if (action.dataset.action === 'copy-url') {
      const url = action.dataset.url;
      if (!url) return;
      try { await navigator.clipboard.writeText(url); } catch {}
      action.textContent = 'Copied!';
      setTimeout(() => { action.textContent = 'Copy stream URL'; }, 1400);
    }
  });

  function render(station, { full, wiki, wikiLoading }) {
    const data = { ...station, ...(full ?? {}) };
    const initials = getInitials(data.name);
    const tags = Array.isArray(data.tags) ? data.tags.filter(Boolean).slice(0, 8) : [];

    const heroImage = wiki?.thumbnail
      ? `<img class="station-info__hero" src="${escapeHtml(wiki.thumbnail)}" alt="">`
      : data.favicon
        ? `<img class="station-info__logo" src="${escapeHtml(data.favicon)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'station-info__initials',textContent:${JSON.stringify(initials)}}))">`
        : `<div class="station-info__initials">${escapeHtml(initials)}</div>`;

    const tagsHtml = tags.length
      ? `<div class="station-info__tags">${tags.map((t) => `<span class="station-info__tag">${escapeHtml(t)}</span>`).join('')}</div>`
      : '';

    const aboutBlock = wikiLoading
      ? `<section class="station-info__section">
           <h4>About</h4>
           <p class="station-info__loading">Looking up on Wikipedia…</p>
         </section>`
      : wiki
        ? `<section class="station-info__section">
             <h4>About</h4>
             <p class="station-info__about">${escapeHtml(wiki.extract)}</p>
             <p class="station-info__source">
               via <a href="${escapeHtml(wiki.url)}" target="_blank" rel="noopener">Wikipedia: ${escapeHtml(wiki.title)} →</a>
             </p>
           </section>`
        : '';

    const streamRows = [];
    streamRows.push(['Format', streamKind(data.url)]);
    if (data.codec) streamRows.push(['Codec', data.codec.toUpperCase()]);
    if (data.bitrate) streamRows.push(['Bitrate', `${data.bitrate} kbps`]);
    if (data.countrycode) streamRows.push(['Country', data.countrycode.toUpperCase()]);
    // Note: votes + clickcount come from Radio Browser too, but those
    // counters only reflect activity inside other RB-aware apps — they
    // misrepresent real-world listenership (NTS has 43 RB-plays vs
    // millions of actual listeners). Intentionally not shown so the
    // sheet doesn't lie about popularity.

    const streamHtml = `
      <section class="station-info__section">
        <h4>Stream</h4>
        <dl class="station-info__stream">
          ${streamRows
            .map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`)
            .join('')}
        </dl>
      </section>`;

    const actions = `
      <div class="station-info__actions">
        ${data.homepage
          ? `<a class="btn-secondary station-info__action" href="${escapeHtml(data.homepage)}" target="_blank" rel="noopener">Visit homepage</a>`
          : ''}
        <button type="button" class="btn-secondary station-info__action" data-action="copy-url" data-url="${escapeHtml(data.url ?? '')}">Copy stream URL</button>
      </div>`;

    return `
      <header class="station-info__header">
        ${heroImage}
        <div class="station-info__meta">
          <div class="station-info__name">${escapeHtml(data.name ?? '')}</div>
          ${tagsHtml}
        </div>
      </header>
      ${aboutBlock}
      ${streamHtml}
      ${actions}
    `;
  }

  let openToken = 0;

  async function open(station) {
    if (!station) return;
    const token = ++openToken;
    titleEl.textContent = station.name ?? 'Station';
    body.innerHTML = render(station, { full: null, wiki: null, wikiLoading: true });
    openModal(modal);

    // Fire both lookups in parallel. Re-render on each resolve so the
    // user sees Radio-Browser metadata land first (faster) and the
    // Wikipedia block fill in (or quietly disappear) shortly after.
    const fullPromise = getStationByUuid(station.id).catch(() => null);
    const wikiPromise = fetchStationInfo(station.name).catch(() => null);

    fullPromise.then((full) => {
      if (token !== openToken) return;
      body.innerHTML = render(station, { full, wiki: null, wikiLoading: true });
    });

    const [full, wiki] = await Promise.all([fullPromise, wikiPromise]);
    if (token !== openToken) return;
    body.innerHTML = render(station, { full, wiki, wikiLoading: false });
  }

  return { open };
}
