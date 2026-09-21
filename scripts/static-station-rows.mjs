// Build-time rendering of the community list into index.html.
//
// Why: the station names only exist in the DOM after main.js has fetched
// /community-radios.json. Google renders JS and sees them, but the crawlers
// that feed our best-converting referral channel (ChatGPT and friends, ~40 %
// play rate) and every social/link preview scraper do not execute JS at all,
// so to them radiodock.app is an app shell with no content. These rows put the
// list in the raw HTML; station-list.js adopts and replaces the same container
// on its first render, so nothing is duplicated and nothing is hidden.
//
// Markup mirrors stationRow() in src/ui/station-list.js minus the logo slot:
// a logo chip here would fire 69 requests to the logo CDN behind the intro
// overlay, for rows the app replaces a moment later.

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {Array<{id?: string, name?: string, countrycode?: string}>} stations
 * @param {{limit?: number}} [opts]
 * @returns {string} a `.station-list-rows` container, or '' when there is nothing to render
 */
export function renderStaticStationRows(stations, { limit = 200 } = {}) {
  const rows = (Array.isArray(stations) ? stations : [])
    .filter((s) => s && typeof s.name === 'string' && s.name.trim())
    .slice(0, limit)
    .map((s) => {
      const id = escapeHtml(s.id ?? '');
      const name = escapeHtml(s.name.trim());
      const country = escapeHtml(s.countrycode ?? '');
      return `<div class="station-item" data-id="${id}">`
        + '<div class="station-item-info">'
        + `<div class="station-item-name">${name}</div>`
        + `<div class="station-item-country">${country}</div>`
        + '</div></div>';
    });
  if (!rows.length) return '';
  return `<div class="station-list-rows" data-prerendered="community">${rows.join('')}</div>`;
}
