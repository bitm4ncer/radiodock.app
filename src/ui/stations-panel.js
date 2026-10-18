// Stations page: browse, search and Discover. Owns state, requests and the
// panel lifecycle. Main.js wires the data clients and play/list actions.

import { stationsRow, updateRowNowPlaying } from './stations-row.js';
import { mountStationsFilters } from './stations-filter.js';
import { buildBrowseParams, mergeRows, searchModeFor, popularParams, searchParams, MAX_ROWS } from './stations-state.js';
import { escapeHtml, formatCount } from './stations-format.js';
import * as storage from '../data/storage.js';

const LETTERS = ['All', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''), '#'];

function isAppRegime() {
  return matchMedia('(max-width: 699px)').matches
    || document.documentElement.classList.contains('is-standalone')
    || !!window.electronAPI;
}

function closeIcon() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
}

function shuffleIcon() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h3c4 0 5 10 9 10h4m0 0-3-3m3 3-3 3M4 17h3c1.5 0 2.5-1.3 3.5-3M14 9c.8-1.2 1.5-2 2-2h4m0 0-3-3m3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

export function mountStationsPanel({ elements = {}, data = {}, actions = {} } = {}) {
  const panel = elements.panel ?? document.getElementById('stationsPanel');
  const backdrop = elements.backdrop ?? document.getElementById('stationsBackdrop');
  const body = elements.body ?? document.getElementById('stationsBody');

  if (!panel || !body) {
    return {
      open() {},
      close() {},
      isOpen: () => false,
      focusSearch() {},
      setNowPlaying() {},
      refreshAddedFlags() {},
    };
  }

  const state = {
    view: 'stations',
    mode: 'az',
    query: '',
    letter: 'all',
    country: '',
    genre: '',
    hasDescription: false,
    offset: 0,
    rows: [],
    total: 0,
    nextOffset: null,
    letterCounts: null,
    statsUpdatedAt: null,
    meta: null,
    loading: false,
    error: null,
  };

  let isOpen = false;
  let previousMode = 'az';
  let previousFocus = null;
  let loadToken = 0;
  let controller = null;
  let metaPromise = null;
  let filters = null;
  let searchTimer = null;
  let panelPosition = null;

  function shell() {
    body.innerHTML = `
      <div class="stations-shell">
        <header class="stations-header">
          <div class="stations-header-copy">
            <p class="stations-kicker">RadioDock Database</p>
            <h2 class="stations-title" id="stationsTitle">Stations <span class="stations-count" id="stationsTotal"></span></h2>
          </div>
          <div class="stations-header-actions">
            <button type="button" class="stations-pill" data-action="discover">Discover</button>
            <button type="button" class="stations-icon-btn" data-action="shuffle" aria-label="Play a random station" title="Play a random station">${shuffleIcon()}</button>
            <button type="button" class="stations-icon-btn" data-action="close" aria-label="Close Stations">${closeIcon()}</button>
          </div>
        </header>
        <div class="stations-search-wrap">
          <input type="search" id="stationsSearch" class="stations-search-input" placeholder="Search stations or genres" autocomplete="off" value="${escapeHtml(state.query)}" />
        </div>
        <div class="stations-controls">
          <div class="stations-mode" role="group" aria-label="Sort stations">
            <button type="button" data-mode="az" aria-pressed="${state.mode === 'az'}">A-Z</button>
            <button type="button" data-mode="popular" aria-pressed="${state.mode === 'popular'}">Popular</button>
          </div>
          <div id="stationsFilters" class="stations-filters"></div>
        </div>
        <div class="stations-main">
          <nav id="stationsRail" class="stations-rail" aria-label="Jump to letter"></nav>
          <div id="stationsContent" class="stations-content"></div>
        </div>
      </div>
    `;
    body.querySelector('[data-action="close"]')?.addEventListener('click', close);
    body.querySelector('[data-action="discover"]')?.addEventListener('click', openDiscover);
    body.querySelector('[data-action="shuffle"]')?.addEventListener('click', shuffle);
    const input = body.querySelector('#stationsSearch');
    input?.addEventListener('input', scheduleSearch);
    body.querySelector('.stations-mode')?.addEventListener('click', (evt) => {
      const button = evt.target.closest('[data-mode]');
      if (button) setMode(button.dataset.mode);
    });
    body.querySelector('#stationsContent')?.addEventListener('click', onContentClick);
    body.querySelector('#stationsRail')?.addEventListener('click', (evt) => {
      const button = evt.target.closest('[data-letter]');
      if (!button || button.disabled) return;
      state.letter = button.dataset.letter;
      state.offset = 0;
      load({ reset: true });
    });
    filters?.close();
    filters = mountStationsFilters({
      root: body.querySelector('#stationsFilters'),
      getMeta: () => state.meta,
      onChange: (next) => {
        state.country = next.country;
        state.genre = next.genre;
        state.hasDescription = next.hasDescription;
        state.offset = 0;
        load({ reset: true });
      },
    });
    renderHeader();
    renderRail();
    renderContent();
  }

  function renderHeader() {
    const total = body.querySelector('#stationsTotal');
    if (total) total.textContent = state.meta?.totalStations ? formatCount(state.meta.totalStations) : '';
    body.querySelectorAll('[data-mode]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.mode === state.mode));
    });
    const mode = body.querySelector('.stations-mode');
    if (mode) mode.hidden = state.mode === 'search';
  }

  function renderRail() {
    const rail = body.querySelector('#stationsRail');
    if (!rail) return;
    const show = state.mode === 'az' && !state.query;
    rail.hidden = !show;
    if (!show) return;
    const counts = state.letterCounts ?? {};
    rail.innerHTML = LETTERS.map((letter) => {
      const value = letter === 'All' ? 'all' : letter;
      const count = letter === 'All'
        ? (counts.All ?? counts.all ?? state.total ?? 0)
        : (counts[letter] ?? 0);
      return `<button type="button" data-letter="${value}" aria-pressed="${state.letter === value}"${count ? '' : ' disabled'} title="${escapeHtml(letter)}: ${formatCount(count)}">${escapeHtml(letter)}</button>`;
    }).join('');
  }

  function sectionHead() {
    if (state.mode === 'search' && state.query) {
      return `<strong>${formatCount(state.total)} stations for "${escapeHtml(state.query)}"</strong><button type="button" data-action="clear-search">Clear</button>`;
    }
    if (state.mode === 'popular') {
      return '<strong>Popular this month</strong><span>Last 30 days by plays <button type="button" class="stations-info-btn" data-action="popular-info" aria-label="About Popular">i</button></span>';
    }
    if (state.letter === 'all') {
      return `<strong>All stations</strong><span>${formatCount(state.total)} total</span>`;
    }
    return `<strong>${escapeHtml(state.letter)}</strong><span>${formatCount(state.total)} stations</span>`;
  }

  function renderContent() {
    const content = body.querySelector('#stationsContent');
    if (!content) return;
    content.setAttribute('aria-busy', String(state.loading));
    if (state.loading && !state.rows.length) {
      content.innerHTML = `${sectionHead()}<div class="stations-list">${Array.from({ length: 8 }, () => '<div class="stations-skeleton"></div>').join('')}</div>`;
      return;
    }
    if (state.error && !state.rows.length) {
      content.innerHTML = `
        <div class="stations-section-head">${sectionHead()}</div>
        <div class="stations-error">
          <p>${escapeHtml(state.error)}</p>
          <button type="button" class="stations-pill" data-action="retry">Retry</button>
        </div>`;
      return;
    }
    if (!state.rows.length) {
      content.innerHTML = emptyState();
      return;
    }
    const canAdd = !!actions.canAddToActiveList?.();
    const rows = state.rows.map((station) => stationsRow(station, {
      query: state.mode === 'search' ? state.query : '',
      mode: state.mode,
      canAdd,
      alreadyAdded: !!actions.isAlreadyInActiveList?.(station.id),
    })).join('');
    const atCap = state.rows.length >= MAX_ROWS;
    const more = state.nextOffset != null && !atCap
      ? '<button type="button" class="stations-load-more" data-action="more">Load more stations</button>'
      : atCap
        ? '<p class="stations-empty">Showing the first 500 stations. Narrow the filters to see more.</p>'
        : '';
    content.innerHTML = `
      <div class="stations-section-head">${sectionHead()}</div>
      <div class="stations-list${state.loading ? ' is-loading' : ''}">${rows}</div>
      ${more}
    `;
  }

  function emptyState() {
    const head = `<div class="stations-section-head">${sectionHead()}</div>`;
    if (state.mode === 'popular') {
      return `${head}<div class="stations-empty"><p>Popular is still warming up.</p><button type="button" class="stations-pill" data-action="browse-az">Browse A-Z</button></div>`;
    }
    if (state.hasDescription) {
      return `${head}<div class="stations-empty"><p>No descriptions here yet.</p><p>Open a station and choose Suggest an edit to add one.</p><button type="button" class="stations-pill" data-action="clear-filters">Browse all</button></div>`;
    }
    if (state.mode === 'search') {
      return `${head}<div class="stations-empty"><p>No stations found for "${escapeHtml(state.query)}".</p><button type="button" class="stations-pill" data-action="clear-search">Clear search</button></div>`;
    }
    return `${head}<div class="stations-empty"><p>No stations match these filters.</p><button type="button" class="stations-pill" data-action="clear-filters">Clear filters</button></div>`;
  }

  function onContentClick(evt) {
    const action = evt.target.closest('[data-action]');
    if (action) {
      const name = action.dataset.action;
      if (name === 'more') {
        load({ reset: false });
        return;
      }
      if (name === 'retry') {
        load({ reset: true });
        return;
      }
      if (name === 'clear-search') {
        clearSearch();
        return;
      }
      if (name === 'browse-az') {
        setMode('az');
        return;
      }
      if (name === 'clear-filters') {
        clearFilters();
        return;
      }
      if (name === 'popular-info') {
        actions.toast?.('Ranked by plays in the last 30 days. Minimum 5 plays. Background listening can influence this list.');
        return;
      }
    }
    const row = evt.target.closest('[data-id]');
    if (!row) return;
    const station = state.rows.find((s) => s.id === row.dataset.id);
    if (!station) return;
    const button = evt.target.closest('[data-action]');
    if (button?.dataset.action === 'info') {
      actions.onInfo?.(station);
      return;
    }
    if (button?.dataset.action === 'add') {
      actions.onAdd?.(station);
      return;
    }
    if (button?.dataset.action === 'play' || !button) {
      actions.onPlay?.(station);
    }
  }

  function scheduleSearch() {
    const input = body.querySelector('#stationsSearch');
    if (!input) return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const next = searchModeFor(input.value, previousMode);
      if (next.mode === 'search') {
        if (state.mode !== 'search') previousMode = state.mode;
        state.mode = 'search';
        state.query = next.query;
        state.letter = 'all';
        state.offset = 0;
        load({ reset: true });
      } else if (state.mode === 'search') {
        state.mode = next.mode;
        state.query = '';
        state.letter = 'all';
        state.offset = 0;
        load({ reset: true });
      }
      renderHeader();
    }, 300);
  }

  function clearSearch() {
    clearTimeout(searchTimer);
    const input = body.querySelector('#stationsSearch');
    if (input) input.value = '';
    state.mode = previousMode === 'search' ? 'az' : previousMode;
    state.query = '';
    state.letter = 'all';
    state.offset = 0;
    load({ reset: true });
  }

  function clearFilters() {
    state.country = '';
    state.genre = '';
    state.hasDescription = false;
    state.letter = 'all';
    state.offset = 0;
    filters?.setState({ country: '', genre: '', hasDescription: false });
    load({ reset: true });
  }

  function setMode(mode) {
    if (mode === state.mode && !state.query) return;
    previousMode = mode;
    state.mode = mode;
    state.query = '';
    state.letter = 'all';
    state.offset = 0;
    const input = body.querySelector('#stationsSearch');
    if (input) input.value = '';
    load({ reset: true });
  }

  async function ensureMeta() {
    if (state.meta) return state.meta;
    if (!metaPromise) {
      metaPromise = Promise.resolve(data.getBrowseMeta?.())
        .then((meta) => {
          state.meta = meta ?? {};
          return state.meta;
        })
        .catch(() => {
          metaPromise = null;
          return null;
        });
    }
    return metaPromise;
  }

  async function load({ reset = false } = {}) {
    if (reset) {
      state.offset = 0;
      state.rows = [];
      state.nextOffset = null;
      state.error = null;
    }
    controller?.abort();
    controller = new AbortController();
    const token = ++loadToken;
    state.loading = true;
    renderContent();
    try {
      await ensureMeta();
      const result = await data.browseStations(
        state.mode === 'popular' ? popularParams(state)
          : state.mode === 'search' ? searchParams(state)
            : buildBrowseParams(state),
        { signal: controller.signal },
      );
      if (token !== loadToken) return;
      const incoming = result?.stations ?? [];
      state.rows = reset ? mergeRows([], incoming) : mergeRows(state.rows, incoming);
      state.total = result?.total ?? state.rows.length;
      state.nextOffset = result?.nextOffset ?? null;
      state.letterCounts = result?.letterCounts ?? state.letterCounts;
      state.statsUpdatedAt = result?.statsUpdatedAt ?? state.statsUpdatedAt;
      state.loading = false;
      state.error = null;
      renderHeader();
      renderRail();
      renderContent();
      body.querySelector('#stationsSearch')?.setAttribute('aria-label', 'Search stations or genres');
    } catch (err) {
      if (controller.signal.aborted || token !== loadToken) return;
      state.loading = false;
      state.error = err?.message || 'Could not load stations.';
      renderContent();
    }
  }

  async function shuffle() {
    if (state.mode === 'search') return;
    try {
      const station = await data.getRandomStation?.({
        letter: state.letter !== 'all' ? state.letter : '',
        country: state.country,
        genre: state.genre,
        hasDescription: state.hasDescription,
      });
      if (station) actions.onPlay?.(station);
      else actions.toast?.('No station matches these filters.');
    } catch {
      actions.toast?.('No station matches these filters.');
    }
  }

  function openDiscover() {
    state.view = 'discover';
    body.innerHTML = `
      <div class="stations-shell">
        <header class="stations-header">
          <button type="button" class="stations-icon-btn" data-action="back" aria-label="Back to Stations">←</button>
          <div class="stations-header-copy">
            <p class="stations-kicker">Stations</p>
            <h2 class="stations-title" id="stationsTitle">Discover</h2>
          </div>
          <button type="button" class="stations-icon-btn" data-action="close" aria-label="Close Stations">${closeIcon()}</button>
        </header>
        <div id="stationsContent" class="stations-content">
          <div class="stations-empty">Collections are being prepared.</div>
        </div>
      </div>`;
    body.querySelector('[data-action="back"]')?.addEventListener('click', backToStations);
    body.querySelector('[data-action="close"]')?.addEventListener('click', close);
  }

  function backToStations() {
    state.view = 'stations';
    shell();
    renderAll();
    load({ reset: false });
  }

  function renderAll() {
    renderHeader();
    renderRail();
    renderContent();
  }

  async function applyPosition() {
    if (!panelPosition) {
      panelPosition = await storage.getPref('stationsPanelPos', null).catch(() => null);
    }
    if (!panelPosition || !isAppRegime()) return;
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const left = Math.min(Math.max(0, panelPosition.left), Math.max(0, window.innerWidth - width));
    const top = Math.min(Math.max(0, panelPosition.top), Math.max(0, window.innerHeight - height));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.transform = 'none';
  }

  function startDrag(evt) {
    if (isAppRegime() || evt.button !== 0) return;
    if (evt.target.closest('button, input, a')) return;
    const rect = panel.getBoundingClientRect();
    const offsetX = evt.clientX - rect.left;
    const offsetY = evt.clientY - rect.top;
    panel.style.transform = 'none';
    panel.style.left = `${rect.left}px`;
    panel.style.top = `${rect.top}px`;
    panel.classList.add('is-dragging');

    function move(event) {
      const left = Math.max(0, Math.min(event.clientX - offsetX, window.innerWidth - panel.offsetWidth));
      const top = Math.max(0, Math.min(event.clientY - offsetY, window.innerHeight - panel.offsetHeight));
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
    }

    function up() {
      panel.classList.remove('is-dragging');
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      panelPosition = { left: panel.offsetLeft, top: panel.offsetTop };
      storage.setPref('stationsPanelPos', panelPosition).catch(() => {});
    }

    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up, { once: true });
  }

  function onKeydown(evt) {
    if (!isOpen) return;
    if (evt.key === 'Escape') {
      if (filters?.isOpen()) {
        filters.close();
        evt.preventDefault();
        return;
      }
      if (state.view === 'discover') {
        backToStations();
        evt.preventDefault();
        return;
      }
      close();
      return;
    }
    if (evt.key !== 'Tab' || !isAppRegime()) return;
    const focusable = [...panel.querySelectorAll('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter((el) => el.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (evt.shiftKey && document.activeElement === first) {
      evt.preventDefault();
      last.focus();
    } else if (!evt.shiftKey && document.activeElement === last) {
      evt.preventDefault();
      first.focus();
    }
  }

  function open({ query = '' } = {}) {
    const firstOpen = !isOpen;
    previousFocus = document.activeElement;
    if (firstOpen || state.view !== 'stations') {
      state.view = 'stations';
      if (firstOpen) {
        isOpen = true;
        panel.classList.add('is-open');
        panel.setAttribute('aria-hidden', 'false');
        if (backdrop) backdrop.hidden = false;
        document.body.classList.add('stations-overlay-open');
        window.dispatchEvent(new CustomEvent('rd:page-open', { detail: { id: 'stations' } }));
      }
      shell();
      applyPosition();
    }
    const trimmed = String(query ?? '').trim();
    if (trimmed) {
      previousMode = state.mode === 'search' ? previousMode : state.mode;
      state.mode = 'search';
      state.query = trimmed;
      state.letter = 'all';
      state.offset = 0;
      const input = body.querySelector('#stationsSearch');
      if (input) input.value = trimmed;
      load({ reset: true });
    } else if (!state.rows.length) {
      load({ reset: true });
    }
    setTimeout(() => {
      const target = isAppRegime()
        ? body.querySelector('[data-action="close"]')
        : body.querySelector('#stationsSearch');
      target?.focus();
    }, 30);
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    loadToken++;
    controller?.abort();
    panel.classList.remove('is-open');
    panel.setAttribute('aria-hidden', 'true');
    if (backdrop) backdrop.hidden = true;
    document.body.classList.remove('stations-overlay-open');
    if (previousFocus?.focus) previousFocus.focus();
  }

  panel.addEventListener('pointerdown', startDrag);
  panel.addEventListener('keydown', onKeydown);
  backdrop?.addEventListener('click', close);

  return {
    open,
    close,
    isOpen: () => isOpen,
    focusSearch() {
      body.querySelector('#stationsSearch')?.focus();
    },
    setNowPlaying(id) {
      body.querySelectorAll('.stations-row').forEach((row) => {
        updateRowNowPlaying(row, row.dataset.id === id);
      });
    },
    refreshAddedFlags() {
      if (state.view === 'stations') renderContent();
    },
  };
}
