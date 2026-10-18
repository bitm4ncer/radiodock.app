import { renderLogoSlot } from './station-logo.js';
import { escapeHtml, highlightMatches, countryLabel, formatCount } from './stations-format.js';

function avgShort(value) {
  const avg = Number(value ?? 0);
  if (!Number.isFinite(avg) || avg <= 0) return '';
  const rounded = avg >= 10 ? Math.round(avg) : Math.round(avg * 10) / 10;
  return `${rounded}m`;
}

const PLAY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10-6.5-10-6.5Z" fill="currentColor"/></svg>';
const CLOCK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 7.5V12l3 1.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
const LISTENER_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5.5 19c.7-3.2 3.2-5 6.5-5s5.8 1.8 6.5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

function countryChip(station) {
  const code = String(station.countrycode ?? '').trim().toUpperCase();
  if (!code) return '';
  const label = countryLabel(code) || code;
  return `<span class="stations-row-country" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${escapeHtml(code)}</span>`;
}

function genreChip(station, query) {
  const genre = String(station.genreLabel ?? '').trim();
  if (!genre) return '';
  return `<span class="stations-row-genre">${highlightMatches(genre, query)}</span>`;
}

function statChip(icon, value, label) {
  return `<span class="stations-row-stat" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${icon}<span>${escapeHtml(value)}</span></span>`;
}

function metaLine(station, mode, query, algorithm) {
  const city = String(station.city ?? '').trim();
  const v2 = mode === 'popular' && algorithm === 'v2';
  const reach = mode === 'popular' ? (v2 ? formatCount(station.reach) : formatCount(station.plays)) : '';
  const depth = mode === 'popular' ? avgShort(v2 ? station.depth : station.avgMinutes) : '';
  return [
    countryChip(station),
    city ? `<span class="stations-row-city">${escapeHtml(city)}</span>` : '',
    genreChip(station, query),
    reach ? statChip(v2 ? LISTENER_ICON : PLAY_ICON, reach, v2 ? `${reach} listeners` : `${reach} plays`) : '',
    depth ? statChip(CLOCK_ICON, `${depth} ${v2 ? 'typical' : 'avg'}`, `${depth} ${v2 ? 'typical' : 'average'} listening time`) : '',
  ].filter(Boolean).join('');
}

function thirdLine(station, query) {
  if (station.info) {
    return `<span class="stations-row-desc">${escapeHtml(station.info)}</span>`;
  }
  const tags = Array.isArray(station.tags) ? station.tags.filter(Boolean).slice(0, 3) : [];
  if (tags.length) {
    const chips = tags.map((tag) => `<span class="stations-row-tag"><span class="stations-row-hash">#</span>${highlightMatches(tag, query)}</span>`).join('');
    return `<span class="stations-row-tags">${chips}</span>`;
  }
  return '';
}

const INFO_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 10.5v6M12 7.3v.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const HEART_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-9.4A4.1 4.1 0 0 1 12 7.7a4.1 4.1 0 0 1 7 2.9c0 5-7 9.4-7 9.4Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';

export function stationsRow(station, { query = '', mode = 'az', algorithm = 'bootstrap', canAdd = false, alreadyAdded = false, priority = false } = {}) {
  const id = escapeHtml(station.id);
  const rank = mode === 'popular' && station.rank
    ? `<span class="stations-row-rank">${escapeHtml(station.rank)}</span>`
    : '';
  const meta = metaLine(station, mode, query, algorithm);
  const addClass = `stations-icon-btn stations-row-action${alreadyAdded ? ' is-added' : ''}`;
  const add = `<button class="${addClass}" type="button" data-action="add" aria-label="${alreadyAdded ? 'Already in list' : 'Add to list'}" aria-pressed="${alreadyAdded ? 'true' : 'false'}"${canAdd ? '' : ' disabled aria-disabled="true"'}>${HEART_ICON}</button>`;
  return `<article class="stations-row${mode === 'popular' ? ' stations-row--popular' : ''}${alreadyAdded ? ' is-added' : ''}" data-id="${id}">
  <button class="stations-row-main" type="button" data-action="play" aria-pressed="false" aria-label="Play ${escapeHtml(station.name)}">
    ${rank}
    ${renderLogoSlot(station, { imgClass: 'stations-row-logo', initialsClass: 'stations-row-initials', priority })}
    <span class="stations-row-info">
      <span class="stations-row-name">${highlightMatches(station.name, query)}</span>
      <span class="stations-row-meta">${meta}</span>
      ${thirdLine(station, query)}
    </span>
  </button>
  <span class="stations-row-actions">
    <button class="stations-icon-btn stations-row-action" type="button" data-action="info" aria-label="Station info">${INFO_ICON}</button>
    ${add}
  </span>
</article>`;
}

export function updateRowNowPlaying(row, isPlaying) {
  if (!row?.classList) return;
  row.classList.toggle('is-playing', Boolean(isPlaying));
  row.querySelector?.('[data-action="play"]')?.setAttribute('aria-pressed', isPlaying ? 'true' : 'false');
}
