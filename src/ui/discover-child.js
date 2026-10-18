// Discover child page. Curated collections only: sponsored and trending
// entries in discover.json are deliberately ignored.

import { renderLogoSlot } from './station-logo.js';
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
    lists.push({ ...list, slug, title: list.title.trim(), stations: list.stations });
  }
  return { lists };
}

export function featuredList(lists) {
  return Array.isArray(lists) && lists.length ? lists[0] : null;
}

function pluralCount(count, singular) {
  return `${formatCount(count)} ${singular}${count === 1 ? '' : 's'}`;
}

function logoStack(stations = []) {
  return `<span class="stations-logo-stack">${stations.slice(0, 3)
    .map((station) => renderLogoSlot(station, { imgClass: 'stations-stack-logo', initialsClass: 'stations-stack-initials', size: 'sm' }))
    .join('')}</span>`;
}

function featureCard(list) {
  return `
    <button type="button" class="stations-feature" data-collection="${escapeHtml(list.slug)}">
      <span class="stations-feature-art">${logoStack(list.stations)}</span>
      <span class="stations-feature-copy">
        <span class="stations-kicker">Collection of the week</span>
        <strong>${escapeHtml(list.title)}</strong>
        <span class="stations-feature-meta">${pluralCount(list.stations.length, 'station')}</span>
      </span>
      <span class="stations-feature-arrow" aria-hidden="true">→</span>
    </button>
  `;
}

function collectionCard(list) {
  return `
    <button type="button" class="stations-collection-card" data-collection="${escapeHtml(list.slug)}">
      <span class="stations-collection-card-top">${logoStack(list.stations)}</span>
      <strong>${escapeHtml(list.title)}</strong>
      <span>${pluralCount(list.stations.length, 'station')}</span>
    </button>
  `;
}

export function renderDiscover({ lists = [], genres = [] } = {}) {
  if (!lists.length) {
    return `
      <div class="stations-discover">
        <div class="stations-empty">
          <p>Collections are being prepared.</p>
          <button type="button" class="stations-pill" data-action="browse-all">Browse all stations</button>
        </div>
      </div>
    `;
  }
  const featured = featuredList(lists);
  const rest = lists.slice(1);
  const topGenres = genres.slice(0, 10);
  return `
    <div class="stations-discover">
      <p class="stations-discover-sub">Curated by RadioDock · ${pluralCount(lists.length, 'collection')}</p>
      ${featureCard(featured)}
      ${rest.length ? `
        <div class="stations-section-head"><strong>All collections</strong><span>${formatCount(rest.length)}</span></div>
        <div class="stations-collection-grid">${rest.map(collectionCard).join('')}</div>
      ` : ''}
      ${topGenres.length ? `
        <div class="stations-section-head"><strong>Browse by genre</strong></div>
        <div class="stations-genre-chips">${topGenres.map((genre) => `
          <button type="button" class="stations-chip" data-genre="${escapeHtml(genre.genre)}">${escapeHtml(genre.label)}</button>
        `).join('')}</div>
      ` : ''}
    </div>
  `;
}

function collectionTile(station) {
  const uuid = station.stationuuid ?? station.uuid ?? station.id ?? '';
  const place = countryLabel(station.countrycode ?? '', station.countrycode ?? '');
  return `
    <article class="stations-collection-tile" data-uuid="${escapeHtml(uuid)}">
      <button type="button" class="stations-collection-tile-main" data-action="collection-play" data-uuid="${escapeHtml(uuid)}">
        ${renderLogoSlot(station, { imgClass: 'stations-row-logo', initialsClass: 'stations-row-initials', size: 'sm' })}
        <span class="stations-collection-tile-info">
          <strong>${escapeHtml(station.name ?? '')}</strong>
          <span>${escapeHtml(place)}</span>
        </span>
      </button>
      <span class="stations-collection-tile-actions">
        <button type="button" class="stations-icon-btn" data-action="collection-info" data-uuid="${escapeHtml(uuid)}" aria-label="Station info">i</button>
        <button type="button" class="stations-icon-btn" data-action="collection-add" data-uuid="${escapeHtml(uuid)}" aria-label="Add to list">+</button>
      </span>
    </article>
  `;
}

export function renderCollection({ list } = {}) {
  if (!list) return '<div class="stations-empty">Collection not found.</div>';
  return `
    <div class="stations-collection">
      <p class="stations-discover-sub">${formatCount(list.stations.length)} stations · Curated list</p>
      <div class="stations-collection-grid is-tiles">${list.stations.map(collectionTile).join('')}</div>
    </div>
  `;
}
