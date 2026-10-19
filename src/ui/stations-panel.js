// Stations page: browse, search and Discover. Owns state, requests and the
// panel lifecycle. Main.js wires the data clients and play/list actions.

import { stationsRow, updateRowNowPlaying } from './stations-row.js';
import { mountStationsFilters } from './stations-filter.js';
import { buildBrowseParams, communityParams, mergeRows, searchModeFor, popularParams, searchParams, MAX_ROWS } from './stations-state.js';
import { escapeHtml, formatCount } from './stations-format.js';
import { normaliseDiscover, renderDiscover, renderCollection } from './discover-child.js';
import { eligibleLists, pickerHtml } from './playlist-picker.js';
import { mountLogoBehavior } from './station-logo.js';
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

function flashElement(el) {
  if (!el) return;
  el.classList.remove('is-flashing');
  void el.offsetWidth;
  el.classList.add('is-flashing');
  const clear = () => el.classList.remove('is-flashing');
  el.addEventListener('animationend', clear, { once: true });
  setTimeout(clear, 500);
}

function shuffleIcon() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h3c4 0 5 10 9 10h4m0 0-3-3m3 3-3 3M4 17h3c1.5 0 2.5-1.3 3.5-3M14 9c.8-1.2 1.5-2 2-2h4m0 0-3-3m3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

function discoverIcon() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="m15.6 8.4-2.1 5.1-5.1 2.1 2.1-5.1 5.1-2.1Z" fill="currentColor"/></svg>';
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
    mode: 'popular',
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
    algorithm: null,
    popularMinListeners: null,
    computedAt: null,
    meta: null,
    loading: false,
    error: null,
    tooShort: false,
    nowPlayingId: null,
    restoreScroll: null,
    animateRows: false,
    discover: null,
    collection: null,
    playlistPicker: null,
  };

  let isOpen = false;
  let lastAppRegime = isAppRegime();
  window.addEventListener('resize', () => {
    const next = isAppRegime();
    if (next === lastAppRegime) return;
    lastAppRegime = next;
    if (isOpen) applyPosition();
  });
  let previousMode = 'popular';
  let previousFocus = null;
  let loadToken = 0;
  let controller = null;
  let metaPromise = null;
  let metaApplied = false;
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
            <button type="button" class="stations-pill stations-discover-btn" data-action="discover">${discoverIcon()}<span>Discover</span></button>
            <button type="button" class="stations-icon-btn" data-action="shuffle" aria-label="Play a random station" title="Play a random station">${shuffleIcon()}</button>
            <button type="button" class="stations-icon-btn" data-action="close" aria-label="Close Stations">${closeIcon()}</button>
          </div>
        </header>
        <div class="stations-search-wrap">
          <input type="search" id="stationsSearch" class="stations-search-input" placeholder="Search stations or genres" autocomplete="off" value="${escapeHtml(state.query)}" />
        </div>
        <div class="stations-controls">
          <div class="stations-mode" role="group" aria-label="Sort stations">
            <button type="button" data-mode="popular" aria-pressed="${state.mode === 'popular'}">Popular</button>
            <button type="button" data-mode="az" aria-pressed="${state.mode === 'az'}">A-Z</button>
            <button type="button" data-mode="community" aria-pressed="${state.mode === 'community'}">Community</button>
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
    body.querySelector('#stationsContent')?.addEventListener('scroll', onContentScroll, { passive: true });
    body.querySelector('#stationsRail')?.addEventListener('click', (evt) => {
      const button = evt.target.closest('[data-letter]');
      if (!button || button.disabled) return;
      state.letter = button.dataset.letter;
      state.offset = 0;
      body.querySelector('#stationsContent')?.scrollTo({ top: 0, behavior: 'smooth' });
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
    filters.setState({
      country: state.country,
      genre: state.genre,
      hasDescription: state.hasDescription,
    });
    renderHeader();
    renderRail();
    renderContent();
  }

  function renderHeader() {
    const total = body.querySelector('#stationsTotal');
    const count = state.mode === 'community'
      ? (state.meta?.communityCount ?? state.total)
      : state.meta?.totalStations;
    if (total) total.textContent = count ? formatCount(count) : '';
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
      const sub = state.algorithm === 'v2'
        ? 'Ranked by listeners, depth, and repeat listening'
        : state.algorithm === 'bootstrap'
          ? 'Early signal: listener data is still building'
          : 'Last 30 days, plays plus listening';
      return `<strong>Popular this month</strong><span>${sub} <button type="button" class="stations-info-btn" data-action="popular-info" aria-label="About Popular">i</button></span>`;
    }
    if (state.mode === 'community') {
      return `<strong>Community Radios</strong><span>Curated · ${formatCount(state.total)} stations</span>`;
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
    if (state.tooShort) {
      content.innerHTML = `<div class="stations-empty"><p>Type at least 2 characters.</p></div>`;
      return;
    }
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
    const rows = state.rows.map((station, index) => stationsRow(station, {
      query: state.mode === 'search' ? state.query : '',
      mode: state.mode,
      algorithm: state.algorithm,
      canAdd,
      alreadyAdded: !!actions.isAlreadyInActiveList?.(station.id),
      priority: index < 10,
    })).join('');
    const atCap = state.mode !== 'popular' && state.rows.length >= MAX_ROWS;
    const more = state.mode === 'popular'
      ? (state.nextOffset != null ? '<div class="stations-endless" aria-hidden="true"></div>' : '')
      : state.nextOffset != null && !atCap
        ? '<button type="button" class="stations-load-more" data-action="more">Load more stations</button>'
        : atCap
          ? '<p class="stations-empty">Showing the first 500 stations. Narrow the filters to see more.</p>'
          : '';
    const restoreScroll = state.restoreScroll;
    const animateRows = state.animateRows;
    state.restoreScroll = null;
    state.animateRows = false;
    content.innerHTML = `
      <div class="stations-section-head">${sectionHead()}</div>
      <div class="stations-list${state.loading ? ' is-loading' : ''}${animateRows ? ' is-entering' : ''}">${rows}</div>
      ${more}
    `;
    if (restoreScroll != null) content.scrollTop = restoreScroll;
    else if (animateRows) content.scrollTo({ top: 0, behavior: 'smooth' });
    mountLogoBehavior(content);
    applyNowPlaying();
    const entering = content.querySelector('.stations-list.is-entering');
    if (entering) setTimeout(() => entering.classList.remove('is-entering'), 400);
  }

  function applyNowPlaying() {
    const id = state.nowPlayingId ?? actions.getNowPlayingId?.() ?? null;
    body.querySelectorAll('.stations-row').forEach((row) => {
      updateRowNowPlaying(row, row.dataset.id === id);
    });
    body.querySelectorAll('.stations-collection-tile').forEach((tile) => {
      tile.classList.toggle('is-playing', tile.dataset.uuid === id);
    });
  }

  function emptyState() {
    const head = `<div class="stations-section-head">${sectionHead()}</div>`;
    if (state.mode === 'popular') {
      const filtered = state.country || state.genre || state.hasDescription;
      return filtered
        ? `${head}<div class="stations-empty"><p>No popular stations match these filters.</p><button type="button" class="stations-pill" data-action="clear-filters">Clear filters</button></div>`
        : `${head}<div class="stations-empty"><p>Popular is still warming up.</p><button type="button" class="stations-pill" data-action="browse-az">Browse A-Z</button></div>`;
    }
    if (state.mode === 'community') {
      const filtered = state.country || state.genre || state.hasDescription;
      return filtered
        ? `${head}<div class="stations-empty"><p>No community stations match these filters.</p><button type="button" class="stations-pill" data-action="clear-filters">Clear filters</button></div>`
        : `${head}<div class="stations-empty"><p>Community Radios is empty.</p><button type="button" class="stations-pill" data-action="browse-az">Browse A-Z</button></div>`;
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
        if (state.nextOffset == null) return;
        state.offset = state.nextOffset;
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
        const message = state.algorithm === 'v2'
          ? 'Ranked by distinct listeners, typical listening time, repeat listening, and session quality over the last 30 days. Stations need at least 10 listeners to qualify. Background listening counts less.'
          : 'Listener data is still building, so this list uses plays and average listening time over the last 30 days. Minimum 5 plays. Background listening can still influence this list.';
        actions.toast?.(message);
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
      button.classList.remove('heart-pop');
      void button.offsetWidth;
      button.classList.add('heart-pop');
      button.addEventListener('animationend', () => button.classList.remove('heart-pop'), { once: true });
      actions.onAdd?.(station);
      return;
    }
    if (button?.dataset.action === 'play' || !button) {
      flashElement(row);
      if (state.nowPlayingId === station.id && actions.togglePlay) actions.togglePlay();
      else actions.onPlay?.(station);
    }
  }

  function onContentScroll() {
    if (state.view !== 'stations' || state.mode !== 'popular') return;
    if (state.loading || state.nextOffset == null) return;
    const content = body.querySelector('#stationsContent');
    if (!content) return;
    if (content.scrollHeight - content.scrollTop - content.clientHeight < 240) {
      state.offset = state.nextOffset;
      load({ reset: false });
    }
  }

  function scheduleSearch() {
    const input = body.querySelector('#stationsSearch');
    if (!input) return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const next = searchModeFor(input.value, previousMode);
      if (next.mode === 'too-short') {
        controller?.abort();
        loadToken++;
        state.tooShort = true;
        state.mode = 'search';
        state.query = next.query;
        state.rows = [];
        state.total = 0;
        state.nextOffset = null;
        state.letter = 'all';
        state.offset = 0;
        state.loading = false;
        state.error = null;
        renderHeader();
        renderRail();
        renderContent();
        return;
      }
      state.tooShort = false;
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
    state.tooShort = false;
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
    state.tooShort = false;
    state.mode = mode;
    state.query = '';
    state.letter = 'all';
    state.offset = 0;
    state.algorithm = null;
    state.popularMinListeners = null;
    state.computedAt = null;
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
          if (!metaApplied && filters) {
            metaApplied = true;
            filters.setState({});
          }
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
    if (state.tooShort) return;
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
          : state.mode === 'community' ? communityParams(state)
            : state.mode === 'search' ? searchParams(state)
              : buildBrowseParams(state),
        { signal: controller.signal },
      );
      if (token !== loadToken) return;
      if (state.view !== 'stations') return;
      const incoming = result?.stations ?? [];
      const content = body.querySelector('#stationsContent');
      if (!reset) state.restoreScroll = content?.scrollTop ?? null;
      const maxRows = state.mode === 'popular' ? null : MAX_ROWS;
      state.rows = reset ? mergeRows([], incoming, maxRows) : mergeRows(state.rows, incoming, maxRows);
      if (reset) {
        state.animateRows = true;
        state.restoreScroll = null;
      }
      state.total = result?.total ?? state.rows.length;
      state.nextOffset = result?.nextOffset ?? null;
      state.letterCounts = result?.letterCounts ?? state.letterCounts;
      state.statsUpdatedAt = result?.statsUpdatedAt ?? state.statsUpdatedAt;
      state.algorithm = result?.algorithm ?? null;
      state.popularMinListeners = result?.popularMinListeners ?? null;
      state.computedAt = result?.computedAt ?? null;
      state.loading = false;
      state.error = null;
      renderHeader();
      renderRail();
      renderContent();
      body.querySelector('#stationsSearch')?.setAttribute('aria-label', 'Search stations or genres');
    } catch (err) {
      if (controller.signal.aborted || token !== loadToken) return;
      if (state.view !== 'stations') return;
      state.loading = false;
      state.error = err?.message || 'Could not load stations.';
      renderContent();
    }
  }

  async function shuffle() {
    if (state.mode === 'search') return;
    try {
      const station = await data.getRandomStation?.({
        mode: state.mode,
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

  function discoverShell(title, backAction, contentHtml) {
    body.innerHTML = `
      <div class="stations-shell">
        <header class="stations-header">
          <button type="button" class="stations-icon-btn" data-action="${backAction}" aria-label="Back">←</button>
          <div class="stations-header-copy">
            <p class="stations-kicker">Stations</p>
            <h2 class="stations-title" id="stationsTitle">${escapeHtml(title)}</h2>
          </div>
          <button type="button" class="stations-icon-btn" data-action="close" aria-label="Close Stations">${closeIcon()}</button>
        </header>
        <div id="stationsContent" class="stations-content">${contentHtml}</div>
      </div>`;
    body.querySelector('[data-action="close"]')?.addEventListener('click', close);
    body.querySelector(`[data-action="${backAction}"]`)?.addEventListener('click', () => {
      if (backAction === 'back-discover') renderDiscoverView();
      else backToStations();
    });
    const content = body.querySelector('#stationsContent');
    content?.addEventListener('click', onDiscoverClick);
    mountLogoBehavior(content);
    queueMicrotask(() => body.querySelector(`[data-action="${backAction}"]`)?.focus());
  }

  function renderDiscoverView() {
    state.view = 'discover';
    state.collection = null;
    const lists = normaliseDiscover(state.discover).lists;
    discoverShell('Discover', 'back', renderDiscover({
      lists,
      genres: state.meta?.genres ?? [],
    }));
  }

  async function openDiscover() {
    controller?.abort();
    loadToken++;
    state.loading = false;
    state.view = 'discover';
    state.collection = null;
    discoverShell('Discover', 'back', '<div class="stations-empty">Loading collections...</div>');
    await ensureMeta();
    state.discover = await data.loadDiscover?.({}) ?? null;
    if (state.view !== 'discover') return;
    renderDiscoverView();
  }

  function openCollection(slug) {
    const list = normaliseDiscover(state.discover).lists.find((item) => item.slug === slug);
    if (!list) return;
    state.collection = list;
    discoverShell(list.title, 'back-discover', renderCollection({ list }));
    applyNowPlaying();
  }

  function renderPlaylistPicker() {
    body.querySelector('.stations-playlist-layer')?.remove();
    const picker = state.playlistPicker;
    if (!picker) return;
    const layer = document.createElement('div');
    layer.className = 'stations-playlist-layer';
    layer.innerHTML = `<section class="stations-playlist-sheet" role="dialog" aria-modal="true" aria-labelledby="playlistPickerTitle">${pickerHtml(picker)}</section>`;
    layer.addEventListener('click', onPlaylistPickerClick);
    layer.addEventListener('submit', (evt) => {
      evt.preventDefault();
      submitPlaylistForm();
    });
    body.appendChild(layer);
    const target = picker.selected
      ? layer.querySelector('#playlistTitle')
      : layer.querySelector('[data-playlist-close]') ?? layer.querySelector('button');
    target?.focus();
  }

  async function openPlaylistPicker() {
    state.playlistPicker = {
      lists: [],
      selected: null,
      title: '',
      note: '',
      error: '',
      submitting: false,
      success: false,
      loading: true,
    };
    renderPlaylistPicker();
    try {
      const lists = await data.getUserLists?.() ?? [];
      if (!state.playlistPicker) return;
      state.playlistPicker.lists = eligibleLists(lists);
      state.playlistPicker.loading = false;
      renderPlaylistPicker();
    } catch (err) {
      if (!state.playlistPicker) return;
      state.playlistPicker.loading = false;
      state.playlistPicker.error = err?.message || 'Could not load your lists.';
      renderPlaylistPicker();
    }
  }

  function closePlaylistPicker() {
    if (!state.playlistPicker) return;
    state.playlistPicker = null;
    body.querySelector('.stations-playlist-layer')?.remove();
    body.querySelector('[data-action="submit-playlist"]')?.focus();
  }

  function onPlaylistPickerClick(evt) {
    if (evt.target.closest('[data-playlist-close]')) {
      closePlaylistPicker();
      return;
    }
    const picker = state.playlistPicker;
    if (!picker) return;
    if (evt.target.closest('[data-playlist-back]')) {
      picker.selected = null;
      picker.title = '';
      picker.note = '';
      picker.error = '';
      renderPlaylistPicker();
      return;
    }
    const select = evt.target.closest('[data-playlist-select]');
    if (select) {
      const list = picker.lists.find((entry) => entry.id === select.dataset.playlistSelect);
      if (!list) return;
      picker.selected = list;
      picker.title = list.name;
      picker.note = '';
      picker.error = '';
      renderPlaylistPicker();
    }
  }

  async function submitPlaylistForm() {
    const picker = state.playlistPicker;
    if (!picker?.selected || picker.submitting) return;
    const title = body.querySelector('#playlistTitle')?.value.trim() ?? '';
    const note = body.querySelector('#playlistNote')?.value.trim() ?? '';
    if (title.length < 2 || title.length > 60) {
      picker.title = title;
      picker.note = note;
      picker.error = 'Title must be 2 to 60 characters.';
      renderPlaylistPicker();
      return;
    }
    picker.title = title;
    picker.note = note;
    picker.submitting = true;
    picker.error = '';
    renderPlaylistPicker();
    try {
      await data.submitPlaylist?.({
        title,
        note,
        stationUuids: picker.selected.stations.map((station) => station.id),
      });
      if (!state.playlistPicker) return;
      state.playlistPicker.success = true;
      state.playlistPicker.submitting = false;
      renderPlaylistPicker();
    } catch (err) {
      if (!state.playlistPicker) return;
      state.playlistPicker.submitting = false;
      state.playlistPicker.error = err?.message || 'Could not submit the playlist.';
      renderPlaylistPicker();
    }
  }

  async function resolveStation(uuid) {
    try {
      const station = await data.getStationByUuid?.(uuid);
      if (!station) {
        actions.toast?.('Station not available right now.');
        return null;
      }
      return station;
    } catch {
      actions.toast?.('Station not available right now.');
      return null;
    }
  }

  async function onDiscoverClick(evt) {
    const collection = evt.target.closest('[data-collection]');
    if (collection) {
      openCollection(collection.dataset.collection);
      return;
    }
    const genre = evt.target.closest('[data-genre]');
    if (genre) {
      applyGenre(genre.dataset.genre);
      return;
    }
    if (evt.target.closest('[data-action="browse-all"]')) {
      browseAll();
      return;
    }
    if (evt.target.closest('[data-action="submit-playlist"]')) {
      openPlaylistPicker();
      return;
    }
    const action = evt.target.closest('[data-action]');
    if (!action) return;
    const name = action.dataset.action;
    if (!name.startsWith('collection-')) return;
    const uuid = action.dataset.uuid;
    if (!uuid) return;
    if (name === 'collection-play') flashElement(action.closest('.stations-collection-tile') ?? action);
    const station = await resolveStation(uuid);
    if (!station) return;
    if (name === 'collection-play') {
      actions.onPlay?.(station);
    }
    else if (name === 'collection-info') actions.onInfo?.(station);
    else if (name === 'collection-add') actions.onAdd?.(station);
  }

  function applyGenre(genre) {
    state.view = 'stations';
    state.collection = null;
    state.mode = 'az';
    state.query = '';
    state.letter = 'all';
    state.genre = genre;
    state.offset = 0;
    shell();
    filters?.setState({ genre });
    load({ reset: true });
  }

  function browseAll() {
    state.view = 'stations';
    state.collection = null;
    state.mode = 'az';
    state.query = '';
    state.letter = 'all';
    state.country = '';
    state.genre = '';
    state.hasDescription = false;
    state.offset = 0;
    shell();
    filters?.setState({ country: '', genre: '', hasDescription: false });
    load({ reset: true });
  }

  function backToStations() {
    state.view = 'stations';
    state.collection = null;
    shell();
    renderAll();
    body.querySelector('[data-action="close"]')?.focus();
    load({ reset: false });
  }

  function renderAll() {
    renderHeader();
    renderRail();
    renderContent();
  }

  async function applyPosition() {
    if (isAppRegime()) {
      panel.style.left = '';
      panel.style.top = '';
      panel.style.transform = '';
      return;
    }
    if (!panelPosition) {
      panelPosition = await storage.getPref('stationsPanelPos', null).catch(() => null);
    }
    if (!panelPosition) return;
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
    if (evt.defaultPrevented) return;
    if (evt.key === 'Escape') {
      if (state.playlistPicker) {
        closePlaylistPicker();
        evt.preventDefault();
        return;
      }
      if (filters?.isOpen()) {
        filters.close();
        evt.preventDefault();
        return;
      }
      if (state.view === 'discover') {
        if (state.collection) renderDiscoverView();
        else backToStations();
        evt.preventDefault();
        return;
      }
      evt.preventDefault();
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

  function onDocumentKeydown(evt) {
    if (!isOpen || evt.key !== 'Escape' || evt.defaultPrevented) return;
    if (panel.contains(evt.target)) return;
    onKeydown(evt);
  }

  function open({ query = '' } = {}) {
    const firstOpen = !isOpen;
    previousFocus = document.activeElement;
    state.tooShort = false;
    if (firstOpen || state.view !== 'stations') {
      state.view = 'stations';
      if (firstOpen) {
        isOpen = true;
        panel.classList.add('is-open');
        panel.setAttribute('aria-hidden', 'false');
        if (backdrop) backdrop.hidden = false;
        document.body.classList.add('stations-overlay-open');
        document.addEventListener('keydown', onDocumentKeydown);
        window.dispatchEvent(new CustomEvent('rd:page-open', { detail: { id: 'stations' } }));
      }
      shell();
      applyPosition();
    }
    state.nowPlayingId = actions.getNowPlayingId?.() ?? state.nowPlayingId;
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
    state.loading = false;
    state.tooShort = false;
    state.playlistPicker = null;
    filters?.close();
    document.removeEventListener('keydown', onDocumentKeydown);
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
      state.nowPlayingId = id ?? null;
      applyNowPlaying();
    },
    refreshAddedFlags() {
      if (state.view !== 'stations') return;
      body.querySelectorAll('[data-action="add"]').forEach((button) => {
        const row = button.closest('[data-id]');
        const added = !!actions.isAlreadyInActiveList?.(row?.dataset.id);
        button.classList.toggle('is-added', added);
        button.setAttribute('aria-pressed', String(added));
        button.setAttribute('aria-label', added ? 'Already in list' : 'Add to list');
      });
    },
  };
}
