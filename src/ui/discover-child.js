// Discover child page. Curated collections only: sponsored and trending
// entries in discover.json are deliberately ignored.

import { renderLogoSlot } from './station-logo.js';
import { stationsRow, HEART_ICON, PLUS_ICON } from './stations-row.js';
import { escapeHtml, countryLabel, formatCount } from './stations-format.js';
import { collectionNoteFor } from './collection-notes.js';

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
  const plural = singular === 'country' ? 'countries' : `${singular}s`;
  return `${formatCount(count)} ${count === 1 ? singular : plural}`;
}

function logoStack(stations = [], { limit = 5, large = false } = {}) {
  return `<span class="stations-logo-stack${large ? ' is-large' : ''}">${stations.slice(0, limit)
    .map((station) => renderLogoSlot(station, { imgClass: 'stations-stack-logo', initialsClass: 'stations-stack-initials', size: 'sm', resolveById: true, priority: true }))
    .join('')}</span>`;
}

function countryCounts(stations = []) {
  const counts = new Map();
  for (const station of stations) {
    const code = String(station?.countrycode ?? '').trim().toUpperCase();
    if (!code) continue;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts.entries()].sort((first, second) => (
    second[1] - first[1] || first[0].localeCompare(second[0])
  ));
}

function stationPreview(stations = [], limit = 3) {
  const names = stations
    .map((station) => String(station?.name ?? '').trim())
    .filter(Boolean);
  if (!names.length) return 'No station names yet';
  const shown = names.slice(0, limit).map(escapeHtml).join(', ');
  const more = names.length - limit;
  return `${shown}${more > 0 ? ` <span class="stations-collection-large-more">+ ${formatCount(more)} more</span>` : ''}`;
}

const CHECK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.4 4.4L19 7.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SEARCH_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="m15.2 15.2 4.3 4.3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
const GRID_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6.5" height="6.5" rx="1" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
const ROWS_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
const ORBIT_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="12" rx="8.5" ry="4.5" fill="none" stroke="currentColor" stroke-width="1.4" transform="rotate(-28 12 12)"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/><circle cx="19.2" cy="7.4" r="1.4" fill="currentColor"/></svg>';

export function collectionSaveButton(list, { saved = false, saving = false } = {}) {
  return `
    <button type="button" class="stations-collection-save${saved ? ' is-saved' : ''}${saving ? ' is-saving' : ''}" data-action="save-collection" data-slug="${escapeHtml(list.slug)}" aria-label="${saved ? 'Collection saved as a list' : 'Save collection as a list'}" title="${saved ? 'Collection saved as a list' : 'Save collection as a list'}" aria-pressed="${saved ? 'true' : 'false'}"${saving ? ' disabled aria-disabled="true"' : ''}>${saved ? CHECK_ICON : PLUS_ICON}</button>
  `;
}

export function syncCollectionSaveButton(button, { saved = false, saving = false } = {}) {
  if (!button) return;
  button.classList.toggle('is-saved', !!saved);
  button.classList.toggle('is-saving', !!saving);
  button.disabled = !!saving;
  button.setAttribute('aria-disabled', String(!!saving));
  button.setAttribute('aria-pressed', String(!!saved));
  button.setAttribute('aria-label', saved ? 'Collection saved as a list' : 'Save collection as a list');
  button.title = saved ? 'Collection saved as a list' : 'Save collection as a list';
  button.innerHTML = saved ? CHECK_ICON : PLUS_ICON;
}

export function collectionCard(list, { user = false, saved = false, saving = false } = {}) {
  return `
    <div class="stations-collection-card-wrap">
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
      ${collectionSaveButton(list, { saved, saving })}
    </div>
  `;
}

export function renderLargeCollectionCard(list, { saved = false, saving = false, expanded = false, user = false } = {}) {
  const slug = escapeHtml(list.slug);
  const title = escapeHtml(list.title);
  const label = expanded ? `Hide stations in ${title}` : `Show all stations in ${title}`;
  const isUser = user || list.source === 'user';
  const note = collectionNoteFor(list);
  const countries = countryCounts(list.stations);
  const countryChips = countries.slice(0, 3).map(([code, count]) => (
    `<span class="stations-collection-large-country" title="${escapeHtml(countryLabel(code, code))}">${escapeHtml(code)} ${formatCount(count)}</span>`
  )).join('');
  const kicker = isUser ? 'Community collection' : list.featured ? 'Featured collection' : 'Curated collection';
  const countLine = `${pluralCount(list.stations.length, 'station')}${countries.length ? ` · ${pluralCount(countries.length, 'country')}` : ''}`;
  return `
    <div class="stations-collection-card-wrap" data-large-slug="${slug}">
      <div class="stations-collection-card is-large${isUser ? ' is-user' : ''}">
        <div class="stations-collection-large-head">
          <button type="button" class="stations-collection-large-main" data-collection="${slug}">
            <span class="stations-collection-card-top">${logoStack(list.stations, { limit: 6, large: true })}</span>
            <span class="stations-collection-large-copy">
              <span class="stations-collection-card-kicker">${escapeHtml(kicker)}</span>
              <strong>${title}</strong>
              <span class="stations-collection-card-count">${countLine}</span>
            </span>
          </button>
          <div class="stations-collection-large-actions">
            ${collectionSaveButton(list, { saved, saving })}
            <button type="button" class="stations-collection-more" data-action="toggle-collection" data-slug="${slug}" aria-expanded="${expanded ? 'true' : 'false'}" aria-label="${label}">...</button>
          </div>
        </div>
        <div class="stations-collection-large-detail">
          <div class="stations-collection-large-row">
            <span class="stations-collection-large-label">Countries</span>
            <span class="stations-collection-large-countries">${countryChips || '<span class="stations-collection-large-country">No country data</span>'}</span>
          </div>
          <div class="stations-collection-large-row">
            <span class="stations-collection-large-label">Includes</span>
            <span class="stations-collection-large-preview">${stationPreview(list.stations)}</span>
          </div>
        </div>
        <div class="stations-collection-large-foot">
          <span class="stations-collection-large-source">${escapeHtml(isUser ? 'Community collection' : 'Curated by RadioDock')}</span>
          <button type="button" class="stations-collection-large-open" data-collection="${slug}" aria-label="Open ${title}">Open collection <span aria-hidden="true">→</span></button>
        </div>
        ${expanded
          ? `<div class="stations-collection-large-stations">
              ${note?.long ? `<p class="stations-collection-large-note">${escapeHtml(note.long)}</p>` : ''}
              <div class="stations-collection-grid is-tiles">${list.stations.map(collectionTile).join('')}</div>
            </div>`
          : ''}
      </div>
    </div>
  `;
}

function submitLink() {
  return '<button type="button" class="stations-submit-link" data-action="submit-playlist">Suggest a collection</button>';
}

export function featuredLists(lists = [], limit = Infinity) {
  return lists.filter((list) => list.featured).slice(0, limit);
}

export function pickFeaturedLists(lists = [], count = 4, random = Math.random) {
  const pool = featuredLists(lists);
  if (count <= 0) return [];
  if (pool.length <= count) return pool;
  const picks = pool.slice();
  for (let i = picks.length - 1; i > 0; i -= 1) {
    const j = Math.min(i, Math.floor(random() * (i + 1)));
    [picks[i], picks[j]] = [picks[j], picks[i]];
  }
  return picks.slice(0, count);
}

export function matchesCollection(list, query) {
  const needle = String(query ?? '').trim().toLowerCase();
  if (!needle) return false;
  const title = String(list?.title ?? '').toLowerCase();
  const slug = String(list?.slug ?? '').toLowerCase();
  return title.includes(needle) || slug.includes(needle);
}

export function searchDiscover(lists = [], query = '') {
  const needle = String(query ?? '').trim().toLowerCase();
  if (!needle) return { collections: [], stations: [], stationTotal: 0 };

  const collections = lists.filter((list) => matchesCollection(list, needle));
  const seen = new Set();
  const stations = [];
  for (const list of lists) {
    for (const station of list.stations ?? []) {
      const name = String(station?.name ?? '');
      if (!name.toLowerCase().includes(needle)) continue;
      const stationuuid = station.stationuuid ?? station.uuid ?? station.id;
      if (!stationuuid || seen.has(stationuuid)) continue;
      seen.add(stationuuid);
      stations.push({
        stationuuid,
        name: station.name,
        countrycode: station.countrycode ?? '',
        collectionSlug: list.slug,
        collectionTitle: list.title,
      });
    }
  }
  return { collections, stations, stationTotal: stations.length };
}

function renderToolbar({ view, query }) {
  const active = ['small', 'large', 'cloud'].includes(view) ? view : 'small';
  const items = [
    { id: 'small', label: 'Small', icon: GRID_ICON },
    { id: 'large', label: 'Large', icon: ROWS_ICON },
    { id: 'cloud', label: 'Cloud', icon: ORBIT_ICON },
  ];
  const value = String(query ?? '');
  return `
    <div class="stations-discover-toolbar">
      <label class="stations-discover-search">
        <span class="stations-discover-search-icon" aria-hidden="true">${SEARCH_ICON}</span>
        <input id="discoverSearchInput" class="stations-discover-search-input" type="search" autocomplete="off" spellcheck="false" placeholder="Search collections or stations" aria-label="Search collections or stations" value="${escapeHtml(value)}" />
        <button type="button" class="stations-discover-clear" data-action="clear-discover-search" aria-label="Clear search"${value.trim() ? '' : ' hidden'}>&times;</button>
      </label>
      <div class="stations-view-toggle" role="group" aria-label="Collection view">
        ${items.map((item) => `<button type="button" class="stations-view-btn" data-view="${item.id}" aria-pressed="${active === item.id}" aria-label="${item.label}" title="${item.label}"><span class="stations-view-icon" aria-hidden="true">${item.icon}</span><span class="stations-view-label">${item.label}</span></button>`).join('')}
      </div>
    </div>
  `;
}

export function renderDiscoverToolbar({ view = 'small', query = '' } = {}) {
  return renderToolbar({ view, query });
}

function renderSmallSections(official, user, isSaved) {
  const officialSection = official.length
    ? `<div class="stations-collection-grid">${official.map((list) => collectionCard(list, { saved: isSaved(list.slug) })).join('')}</div>`
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
        ? `<div class="stations-collection-grid">${user.map((list) => collectionCard(list, { user: true, saved: isSaved(list.slug) })).join('')}</div>`
        : '<p class="stations-user-empty">No community collections yet. Be the first.</p>'}
    </div>
  `;

  return `${officialSection}${userSection}`;
}

function renderLargeSections(official, user, isSaved, expandedSlug) {
  const officialSection = official.length
    ? `<div class="stations-collection-large">${official.map((list) => renderLargeCollectionCard(list, { saved: isSaved(list.slug), expanded: expandedSlug === list.slug })).join('')}</div>`
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
        ? `<div class="stations-collection-large">${user.map((list) => renderLargeCollectionCard(list, { saved: isSaved(list.slug), expanded: expandedSlug === list.slug, user: true })).join('')}</div>`
        : '<p class="stations-user-empty">No community collections yet. Be the first.</p>'}
    </div>
  `;

  return `${officialSection}${userSection}`;
}

function renderSearchResults(lists, { view, query, expandedSlug, isSaved, isFavorited, canAdd }) {
  const matches = searchDiscover(lists, query);
  if (!matches.collections.length && !matches.stations.length) {
    return `
      <div class="stations-empty">
        <p>No collections or stations match "${escapeHtml(String(query ?? '').trim())}".</p>
        <button type="button" class="stations-pill" data-action="clear-discover-search">Clear search</button>
      </div>
    `;
  }

  const collectionSection = matches.collections.length
    ? `
      <div class="stations-section-head"><strong>Collections</strong><span>${formatCount(matches.collections.length)}</span></div>
      ${view === 'large'
        ? `<div class="stations-collection-large">${matches.collections.map((list) => renderLargeCollectionCard(list, { saved: isSaved(list.slug), expanded: expandedSlug === list.slug, user: list.source === 'user' })).join('')}</div>`
        : `<div class="stations-collection-grid">${matches.collections.map((list) => collectionCard(list, { user: list.source === 'user', saved: isSaved(list.slug) })).join('')}</div>`}
    `
    : '';

  const stationRows = matches.stations.slice(0, 12).map((match) => stationsRow(
    { ...match, id: match.stationuuid },
    {
      mode: 'az',
      source: match.collectionTitle,
      canAdd,
      alreadyAdded: isFavorited(match.stationuuid),
    },
  )).join('');

  const stationSection = matches.stations.length
    ? `
      <div class="stations-section-head"><strong>Stations</strong><span>${formatCount(matches.stationTotal)}</span></div>
      <div class="stations-list stations-discover-stations">${stationRows}</div>
      ${matches.stationTotal > 12 ? `<p class="stations-discover-more">+ ${formatCount(matches.stationTotal - 12)} more stations</p>` : ''}
    `
    : '';

  return `<div class="stations-discover-search-results">${collectionSection}${stationSection}</div>`;
}

export function renderDiscoverResults({
  lists = [],
  isSaved = () => false,
  view = 'small',
  query = '',
  expandedSlug = null,
  isFavorited = () => false,
  canAdd = true,
} = {}) {
  if (view === 'cloud') return '<div class="stations-cloud" data-cloud-host></div>';
  if (String(query ?? '').trim()) {
    return renderSearchResults(lists, { view, query, expandedSlug, isSaved, isFavorited, canAdd });
  }
  const official = lists.filter((list) => list.source !== 'user');
  const user = lists.filter((list) => list.source === 'user');
  return view === 'large'
    ? renderLargeSections(official, user, isSaved, expandedSlug)
    : renderSmallSections(official, user, isSaved);
}

export function renderDiscover({
  lists = [],
  isSaved = () => false,
  view = 'small',
  query = '',
  expandedSlug = null,
  isFavorited = () => false,
  canAdd = true,
} = {}) {
  const activeView = ['small', 'large', 'cloud'].includes(view) ? view : 'small';
  return `
    <div class="stations-discover${activeView === 'cloud' ? ' is-cloud' : ''}">
      ${renderDiscoverToolbar({ view: activeView, query })}
      <div id="discoverResults" class="stations-discover-results">
        ${renderDiscoverResults({ lists, isSaved, view: activeView, query, expandedSlug, isFavorited, canAdd })}
      </div>
    </div>
  `;
}

export function renderDiscoverUnavailable() {
  return '<div class="stations-empty"><p>Discover is unavailable right now. Search and playback still work.</p></div>';
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
