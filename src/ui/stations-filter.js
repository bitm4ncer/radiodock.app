// Country, genre and description filters for the Stations page. The same
// controller serves the desktop popover and the mobile bottom sheet.

import { escapeHtml, formatCount } from './stations-format.js';

export function filterOptions(items, query, labelKey = 'name') {
  const needle = String(query ?? '').trim().toLowerCase();
  if (!needle) return items.slice();
  return items.filter((item) => {
    const label = String(item?.[labelKey] ?? '').toLowerCase();
    const code = String(item?.code ?? '').toLowerCase();
    const genre = String(item?.genre ?? '').toLowerCase();
    return label.includes(needle) || code.includes(needle) || genre.includes(needle);
  });
}

export function chipLabel(kind, value, meta = {}) {
  if (kind === 'description') return 'Description';
  if (kind === 'country') {
    const found = meta.countries?.find((c) => c.code === value);
    return found?.name || value || 'Country';
  }
  if (kind === 'genre') {
    const found = meta.genres?.find((g) => g.genre === value);
    return found?.label || value || 'Genre';
  }
  return String(value ?? '');
}

function defaultState() {
  return { country: '', genre: '', hasDescription: false };
}

export function clearFilters(state = {}) {
  return { ...state, country: '', genre: '', hasDescription: false };
}

function isSheetRegime() {
  return matchMedia('(max-width: 699px)').matches
    || document.documentElement.classList.contains('is-standalone');
}

export function mountStationsFilters({ root, getMeta, onChange } = {}) {
  let state = defaultState();
  let openKind = null;
  let popover = null;

  function meta() {
    return getMeta?.() ?? {};
  }

  function fire() {
    onChange?.({ ...state });
  }

  function close() {
    const kind = openKind;
    openKind = null;
    popover?.remove();
    popover = null;
    root?.querySelectorAll('.stations-chip.is-open').forEach((el) => el.classList.remove('is-open'));
    if (kind) root?.querySelector(`[data-filter="${kind}"]`)?.focus();
  }

  function renderChips() {
    if (!root) return;
    const m = meta();
    const descriptionDisabled = (m.descriptionCount ?? 0) === 0;
    const countryText = state.country ? chipLabel('country', state.country, m) : 'Country';
    const genreText = state.genre ? chipLabel('genre', state.genre, m) : 'Genre';
    const hasActive = !!(state.country || state.genre || state.hasDescription);
    root.innerHTML = `
      <button type="button" class="stations-chip${state.country ? ' is-active' : ''}" data-filter="country" aria-expanded="false">
        <span>${escapeHtml(countryText)}</span>${state.country ? '<span aria-hidden="true" data-clear="country">×</span>' : ''}
      </button>
      <button type="button" class="stations-chip${state.genre ? ' is-active' : ''}" data-filter="genre" aria-expanded="false">
        <span>${escapeHtml(genreText)}</span>${state.genre ? '<span aria-hidden="true" data-clear="genre">×</span>' : ''}
      </button>
      <button type="button" class="stations-chip${state.hasDescription ? ' is-active' : ''}" data-filter="description"
        aria-pressed="${state.hasDescription}"${descriptionDisabled ? ' disabled title="No descriptions yet"' : ''}>
        <span>Description</span>
      </button>
      ${hasActive ? '<button type="button" class="stations-clear-all" data-filter="clear-all">Clear all</button>' : ''}
    `;
  }

  function optionRow(kind, value, label, count, selected) {
    return `
      <button type="button" class="stations-filter-option${selected ? ' is-selected' : ''}" data-value="${escapeHtml(value)}">
        <span class="stations-filter-option-label">${escapeHtml(label)}</span>
        <span class="stations-filter-option-count">${formatCount(count ?? 0)}</span>
        <span class="stations-filter-check" aria-hidden="true">${selected ? '✓' : ''}</span>
      </button>
    `;
  }

  function openPicker(kind) {
    const m = meta();
    const isCountry = kind === 'country';
    const items = isCountry ? (m.countries ?? []) : (m.genres ?? []);
    const labelKey = isCountry ? 'name' : 'label';
    const active = isCountry ? state.country : state.genre;
    const title = isCountry ? 'Country' : 'Genre';
    const allLabel = isCountry ? 'All countries' : 'All genres';
    close();
    openKind = kind;
    popover = document.createElement('div');
    popover.className = `stations-filter-popover${isSheetRegime() ? ' is-sheet' : ''}`;
    popover.innerHTML = `
      <div class="stations-filter-popover-head">
        <strong>${title}</strong>
        <button type="button" class="stations-icon-btn" data-action="close" aria-label="Close ${title}">×</button>
      </div>
      <input type="search" class="stations-filter-search" placeholder="Search ${title.toLowerCase()}..." autocomplete="off" />
      <div class="stations-filter-options"></div>
    `;
    const optionsEl = popover.querySelector('.stations-filter-options');

    function renderOptions(query = '') {
      const visible = filterOptions(items, query, labelKey);
      const allCount = items.reduce((sum, item) => sum + (item.count ?? 0), 0);
      optionsEl.innerHTML = [
        optionRow(kind, '', allLabel, allCount, !active),
        ...visible.map((item) => optionRow(
          kind,
          isCountry ? item.code : item.genre,
          isCountry ? item.name : item.label,
          item.count,
          active === (isCountry ? item.code : item.genre),
        )),
      ].join('');
    }

    renderOptions();
    root.appendChild(popover);
    root.querySelector(`[data-filter="${kind}"]`)?.classList.add('is-open');
    root.querySelector(`[data-filter="${kind}"]`)?.setAttribute('aria-expanded', 'true');

    const search = popover.querySelector('.stations-filter-search');
    search?.addEventListener('input', () => renderOptions(search.value));
    search?.focus();

    popover.addEventListener('click', (evt) => {
      if (evt.target.closest('[data-action="close"]')) {
        close();
        return;
      }
      const option = evt.target.closest('.stations-filter-option');
      if (!option) return;
      const value = option.dataset.value;
      if (isCountry) state.country = value;
      else state.genre = value;
      close();
      renderChips();
      fire();
    });
  }

  root?.addEventListener('click', (evt) => {
    const clear = evt.target.closest('[data-clear]');
    if (clear) {
      state[clear.dataset.clear] = '';
      renderChips();
      fire();
      return;
    }
    const chip = evt.target.closest('.stations-chip');
    if (!chip) {
      if (evt.target.closest('[data-filter="clear-all"]')) {
        state = clearFilters(state);
        renderChips();
        fire();
      }
      return;
    }
    const kind = chip.dataset.filter;
    if (kind === 'description') {
      if (chip.disabled) return;
      state.hasDescription = !state.hasDescription;
      renderChips();
      fire();
      return;
    }
    if (openKind === kind) {
      close();
      return;
    }
    openPicker(kind);
  });

  document.addEventListener('click', (evt) => {
    if (!openKind) return;
    if (popover?.contains(evt.target) || root?.contains(evt.target)) return;
    close();
  });

  document.addEventListener('keydown', (evt) => {
    if (evt.key === 'Escape' && openKind) {
      evt.preventDefault();
      close();
    }
  });
  renderChips();

  return {
    setState(next = {}) {
      state = { ...state, ...next };
      renderChips();
      if (openKind) close();
    },
    getState: () => ({ ...state }),
    close,
    isOpen: () => !!openKind,
  };
}
