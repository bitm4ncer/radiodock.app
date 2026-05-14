// Search UI. Owns the input, filter tabs, loading/error/empty/results
// states, and renders result rows. Calls out via callbacks for the
// actual API request and for play / add actions.

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

function resultRow(station, { canAdd, alreadyAdded }) {
  const initials = getInitials(station.name);
  const favicon = station.favicon ? escapeHtml(station.favicon) : '';
  const addBtn = !canAdd
    ? ''
    : alreadyAdded
      ? `<button class="btn-icon" title="Already in list" disabled>✓</button>`
      : `<button type="button" class="btn-icon btn-add" data-action="add" title="Add to current list">
           <svg viewBox="0 0 24 24" class="heart-icon" aria-hidden="true">
             <path d="M16.5 3C19.5376 3 22 5.5 22 9C22 16 14.5 20 12 21.5C9.5 20 2 16 2 9C2 5.5 4.5 3 7.5 3C9.35997 3 11 4 12 5C13 4 14.64 3 16.5 3Z"></path>
           </svg>
         </button>`;
  return `
    <div class="search-item" data-id="${escapeHtml(station.id)}">
      ${favicon
        ? `<img class="station-item-logo" src="${favicon}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'station-item-initials',textContent:${JSON.stringify(initials)}}))" />`
        : `<div class="station-item-initials">${escapeHtml(initials)}</div>`}
      <div class="station-item-info">
        <div class="station-item-name">${escapeHtml(station.name)}</div>
        <div class="station-item-country">${escapeHtml(station.countrycode ?? '')}</div>
      </div>
      <div class="search-item-actions">${addBtn}</div>
    </div>
  `;
}

export function mountSearch({ onSearch, onPlay, onAdd, isAlreadyInActiveList, canAddToActiveList } = {}) {
  const input = document.getElementById('searchInput');
  const clearBtn = document.getElementById('clearSearchBtn');
  const filtersEl = document.getElementById('searchFilters');
  const resultsEl = document.getElementById('searchResults');
  const resultsList = document.getElementById('searchResultsList');
  const loadingEl = document.getElementById('searchLoading');
  const errorEl = document.getElementById('searchError');

  let activeFilter = 'name';
  let debounceTimer = null;
  let currentRequest = null;
  let lastResults = [];

  function setVisibility({ filters, results, loading, error, list }) {
    filtersEl.style.display = filters ? '' : 'none';
    resultsEl.style.display = results ? '' : 'none';
    loadingEl.style.display = loading ? '' : 'none';
    errorEl.style.display = error ? '' : 'none';
    if (typeof list === 'string') resultsList.innerHTML = list;
  }

  function syncEmpty() {
    const has = input.value.length > 0;
    clearBtn.style.display = has ? '' : 'none';
    if (!has) {
      lastResults = [];
      setVisibility({ filters: false, results: false, loading: false, error: false, list: '' });
    }
  }

  function renderResults(stations) {
    lastResults = stations;
    if (!stations.length) {
      setVisibility({
        filters: true,
        results: true,
        loading: false,
        error: false,
        list: `<div class="search-item" style="cursor:default;color:var(--text-muted);">No matches.</div>`,
      });
      return;
    }
    const canAdd = !!canAddToActiveList?.();
    const html = stations
      .map((s) => resultRow(s, { canAdd, alreadyAdded: !!isAlreadyInActiveList?.(s.id) }))
      .join('');
    setVisibility({ filters: true, results: true, loading: false, error: false, list: html });
  }

  function showLoading() {
    setVisibility({ filters: true, results: true, loading: true, error: false, list: '' });
  }

  function showError(message) {
    setVisibility({ filters: true, results: true, loading: false, error: true, list: '' });
    errorEl.querySelector('p').textContent = message || 'Error loading stations. Please try again.';
  }

  async function fire() {
    const query = input.value.trim();
    if (!query) {
      syncEmpty();
      return;
    }
    if (currentRequest) {
      currentRequest.abort();
      currentRequest = null;
    }
    showLoading();
    const ctl = new AbortController();
    currentRequest = ctl;
    try {
      const results = await onSearch?.({ query, filter: activeFilter }, { signal: ctl.signal });
      if (ctl.signal.aborted) return;
      renderResults(results ?? []);
    } catch (err) {
      if (ctl.signal.aborted) return;
      console.error('Search failed:', err);
      showError(err.message);
    } finally {
      if (currentRequest === ctl) currentRequest = null;
    }
  }

  function debouncedFire() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(fire, 300);
  }

  input.addEventListener('input', () => {
    syncEmpty();
    if (input.value.trim()) {
      filtersEl.style.display = '';
      resultsEl.style.display = '';
      debouncedFire();
    }
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    syncEmpty();
    input.focus();
  });

  filtersEl.addEventListener('click', (evt) => {
    const btn = evt.target.closest('.filter-btn');
    if (!btn) return;
    activeFilter = btn.dataset.filter;
    filtersEl.querySelectorAll('.filter-btn').forEach((b) => b.classList.toggle('active', b === btn));
    if (input.value.trim()) {
      showLoading();
      fire();
    }
  });

  resultsList.addEventListener('click', (evt) => {
    const addBtn = evt.target.closest('[data-action="add"]');
    const row = evt.target.closest('[data-id]');
    if (!row) return;
    const station = lastResults.find((s) => s.id === row.dataset.id);
    if (!station) return;
    if (addBtn) {
      evt.stopPropagation();
      onAdd?.(station);
      return;
    }
    onPlay?.(station);
  });

  syncEmpty();

  return {
    focus: () => input.focus(),
    clear: () => {
      input.value = '';
      syncEmpty();
    },
    refreshAddedFlags() {
      if (lastResults.length) renderResults(lastResults);
    },
  };
}
