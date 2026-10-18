import { renderLogoSlot } from './station-logo.js';
import { escapeHtml, highlightMatches, countryLabel, formatCount } from './stations-format.js';

function metaLine(station) {
  const parts = [
    countryLabel(station.countrycode),
    station.city,
    station.genreLabel,
  ].map((part) => String(part ?? '').trim()).filter(Boolean);
  return parts.map(escapeHtml).join(' · ');
}

function thirdLine(station, query) {
  if (station.info) {
    return `<span class="stations-row-desc">${escapeHtml(station.info)}</span>`;
  }
  const tags = Array.isArray(station.tags) ? station.tags.filter(Boolean).slice(0, 3) : [];
  if (tags.length) {
    return `<span class="stations-row-desc stations-row-tags">${tags.map((tag) => highlightMatches(tag, query)).join(' · ')}</span>`;
  }
  if (station.genreLabel) {
    return `<span class="stations-row-desc">${highlightMatches(station.genreLabel, query)}</span>`;
  }
  return '';
}

const INFO_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 10.5v6M12 7.3v.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const HEART_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-9.4A4.1 4.1 0 0 1 12 7.7a4.1 4.1 0 0 1 7 2.9c0 5-7 9.4-7 9.4Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';

export function stationsRow(station, { query = '', mode = 'az', canAdd = false, alreadyAdded = false } = {}) {
  const id = escapeHtml(station.id);
  const rank = mode === 'popular' && station.rank
    ? `<span class="stations-row-rank">${escapeHtml(station.rank)}</span>`
    : '';
  const plays = mode === 'popular'
    ? `<span class="stations-row-plays">${formatCount(station.plays)} plays</span>`
    : '';
  const meta = [metaLine(station), plays].filter(Boolean).join('<span class="stations-row-dot"> · </span>');
  const addClass = `stations-icon-btn stations-row-action${alreadyAdded ? ' is-added' : ''}`;
  const add = `<button class="${addClass}" type="button" data-action="add" aria-label="${alreadyAdded ? 'Already in list' : 'Add to list'}" aria-pressed="${alreadyAdded ? 'true' : 'false'}"${canAdd ? '' : ' disabled aria-disabled="true"'}>${HEART_ICON}</button>`;
  return `<article class="stations-row${mode === 'popular' ? ' stations-row--popular' : ''}${alreadyAdded ? ' is-added' : ''}" data-id="${id}">
  <button class="stations-row-main" type="button" data-action="play" aria-pressed="false" aria-label="Play ${escapeHtml(station.name)}">
    ${rank}
    ${renderLogoSlot(station, { imgClass: 'stations-row-logo', initialsClass: 'stations-row-initials' })}
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
