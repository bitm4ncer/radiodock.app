// Discover child page. Curated collections only: sponsored and trending
// entries in discover.json are deliberately ignored.

import { renderLogoSlot } from './station-logo.js';
import { HEART_ICON } from './stations-row.js';
import { escapeHtml, countryLabel, formatCount } from './stations-format.js';

export function normaliseDiscover(data) {
  const raw = Array.isArray(data?.curated?.lists) ? data.curated.lists : [];
  const seen = new Set();
  const lists = [];
  for (const list of raw) {
    if (!list || typeof list.slug !== 'string' || !list.slug.trim()) continue;
    if (typeof list.title !== 'string' || !list.title.trim()) continue;
    if (!Array.isArray(list.stations) || !list.stations.length) continue;
    const slug = list.slug.trim();
    if (seen.has(slug)) continue;
    seen.add(slug);
    lists.push({
      ...list,
      slug,
      title: list.title.trim(),
      source: list.source === 'user' ? 'user' : 'radiodock',
      featured: !!list.featured,
      stations: list.stations,
    });
  }
  return { lists };
}

function pluralCount(count, singular) {
  return `${formatCount(count)} ${singular}${count === 1 ? '' : 's'}`;
}

function logoStack(stations = []) {
  return `<span class="stations-logo-stack">${stations.slice(0, 5)
    .map((station) => renderLogoSlot(station, { imgClass: 'stations-stack-logo', initialsClass: 'stations-stack-initials', size: 'sm', resolveById: true, priority: true }))
    .join('')}</span>`;
}



export function collectionCard(list, { user = false } = {}) {
  return `
    <button type="button" class="stations-collection-card${user ? ' is-user' : ''}" data-collection="${escapeHtml(list.slug)}">
      <span class="stations-collection-card-top">${logoStack(list.stations)}</span>
      <span class="stations-collection-card-copy">
        ${user ? '<span class="stations-collection-card-kicker">Community collection</span>' : ''}
        <span class="stations-collection-card-line">
          <strong>${escapeHtml(list.title)}</strong>
        </span>
        <span class="stations-collection-card-count">${pluralCount(list.stations.length, 'station')}</span>
      </span>
    </button>
  `;
}

function submitLink() {
  return '<button type="button" class="stations-submit-link" data-action="submit-playlist">Suggest a collection</button>';
}

// The Stations page shows at most six editorial picks, in curated order.
export function featuredLists(lists = [], limit = 6) {
  return lists.filter((list) => list.featured).slice(0, limit);
}

export function renderDiscover({ lists = [] } = {}) {
  const official = lists.filter((list) => list.source !== 'user');
  const user = lists.filter((list) => list.source === 'user');

  const officialSection = official.length
    ? `
      <div class="stations-collection-grid">${official.map((list) => collectionCard(list)).join('')}</div>
    `
    : `
      <div class="stations-empty">
        <p>Collections are being prepared.</p>
        <button type="button" class="stations-pill" data-action="browse-all">Browse all stations</button>
      </div>
    `;

  const userSection = `
    <div class="stations-user-collections">
      <div class="stations-section-head">
        <strong>Community collections</strong>
        <div class="stations-section-actions">
          ${user.length ? `<span>${formatCount(user.length)}</span>` : ''}
          ${submitLink()}
        </div>
      </div>
      ${user.length
        ? `<div class="stations-collection-grid">${user.map((list) => collectionCard(list, { user: true })).join('')}</div>`
        : '<p class="stations-user-empty">No community collections yet. Be the first.</p>'}
    </div>
  `;

  return `
    <div class="stations-discover">
      ${officialSection}
      ${userSection}
    </div>
  `;
}

function collectionTile(station) {
  const uuid = station.stationuuid ?? station.uuid ?? station.id ?? '';
  const place = countryLabel(station.countrycode ?? '', station.countrycode ?? '');
  return `
    <article class="stations-collection-tile" data-uuid="${escapeHtml(uuid)}">
      <button type="button" class="stations-collection-tile-main" data-action="collection-play" data-uuid="${escapeHtml(uuid)}">
        ${renderLogoSlot(station, { imgClass: 'stations-row-logo', initialsClass: 'stations-row-initials', size: 'sm', resolveById: true, priority: true })}
        <span class="stations-collection-tile-info">
          <strong>${escapeHtml(station.name ?? '')}</strong>
          <span>${escapeHtml(place)}</span>
        </span>
      </button>
      <span class="stations-collection-tile-actions">
        <button type="button" class="stations-icon-btn" data-action="collection-info" data-uuid="${escapeHtml(uuid)}" aria-label="Station info" aria-expanded="false">i</button>
        <button type="button" class="stations-icon-btn" data-action="collection-add" data-uuid="${escapeHtml(uuid)}" aria-label="Add to list" aria-pressed="false">${HEART_ICON}</button>
      </span>
    </article>
  `;
}

export function renderCollection({ list } = {}) {
  if (!list) return '<div class="stations-empty">Collection not found.</div>';
  return `
    <div class="stations-collection">
      <p class="stations-discover-sub">${formatCount(list.stations.length)} stations · ${list.source === 'user' ? 'Community collection' : 'Curated collection'}</p>
      <div class="stations-collection-grid is-tiles">${list.stations.map(collectionTile).join('')}</div>
    </div>
  `;
}
