// Stations page: browse, search and Discover. Owns state, requests and the
// panel lifecycle. Main.js wires the data clients and play/list actions.

import { stationsRow, updateRowNowPlaying, HEART_ICON, PLUS_ICON } from './stations-row.js';
import { mountStationsFilters } from './stations-filter.js';
import { buildBrowseParams, communityParams, mergeRows, searchModeFor, popularParams, searchParams, MAX_ROWS } from './stations-state.js';
import { escapeHtml, formatCount } from './stations-format.js';
import { normaliseDiscover, renderDiscover, renderCollection, collectionCard, collectionSaveButton, syncCollectionSaveButton, featuredLists, pickFeaturedLists, renderDiscoverUnavailable } from './discover-child.js';
import { eligibleLists, pickerHtml } from './playlist-picker.js';
import { mountLogoBehavior } from './station-logo.js';
import { createInlineStationInfo } from './station-info-inline.js';
import * as storage from '../data/storage.js';
import { registerSnapSurface, snapPanel, cancelSnap } from './panel-snap.js';
import { resolvePanelSize } from './panel-resize.js';

const LETTERS = ['All', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''), '#'];

function isAppRegime() {
  return matchMedia('(max-width: 699px)').matches
    || document.documentElement.classList.contains('is-standalone')
    || !!window.electronAPI;
}

function closeIcon() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
}

function dragHandle() {
  return `<span class="stations-drag" data-role="drag" title="Drag" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg></span>`;
}

function createResizeHandle() {
  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = 'stations-resize-handle';
  handle.title = 'Resize';
  handle.setAttribute('aria-label', 'Resize stations panel');
  handle.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M14 6 6 14M14 10l-4 4M14 14h.01"/></svg>';
  return handle;
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
  const body = elements.body ?? document.getElementById('stationsBody');
  if (panel) {
    registerSnapSurface(panel, {
      setPosition: setPanelPosition,
      persist: (x, y) => storage.setPref('stationsPanelPos', { left: x, top: y }).catch(() => {}),
    });
  }

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

  const resizeHandle = panel.querySelector('.stations-resize-handle') ?? createResizeHandle();
  if (!resizeHandle.isConnected) panel.appendChild(resizeHandle);

  const state = {
    view: 'stations',
    mode: 'popular',
    query: '',
    letter: 'all',
    country: '',
    genre: '',
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
    featuredSlugs: null,
    animateRows: false,
    discover: null,
    collection: null,
    playlistPicker: null,
  };

  let isOpen = false;
  let lastAppRegime = isAppRegime();
  window.addEventListener('resize', () => {
    const next = isAppRegime();
    const regimeChanged = next !== lastAppRegime;
    lastAppRegime = next;
    if (!isOpen) return;
    if (regimeChanged) {
      applyPosition();
      return;
    }
    if (next) return;
    if (panelSize) applyPanelSize(panelSize.width, panelSize.height);
    if (panelPosition) setPanelPosition(panelPosition.left, panelPosition.top);
  });
  let previousMode = 'popular';
  let previousFocus = null;
  let loadToken = 0;
  let openSettleTimer = null;
  let controller = null;
  let metaPromise = null;
  let metaApplied = false;
  let filters = null;
  let searchTimer = null;
  let panelPosition = null;
  let panelSize = null;
  let inlineInfoEl = null;
  let inlineInfoId = null;
  let moveTimers = [];
  let moveState = null; // { button, stationId }
  let moveMenu = null; // { el, button, station }

  function shell() {
    body.innerHTML = `
      <div class="stations-shell">
        <header class="stations-header stations-header--browse">
          ${dragHandle()}
          <div class="stations-header-copy">
            
            <h2 class="stations-title" id="stationsTitle">Stations</h2>
          </div>
          <div class="stations-header-actions">
            <button type="button" class="stations-icon-btn" data-action="shuffle" aria-label="Play a random station" title="Play a random station">${shuffleIcon()}</button>
            <button type="button" class="stations-icon-btn" data-action="close" aria-label="Close Stations">${closeIcon()}</button>
          </div>
        </header>
        <div id="stationsFeatured" class="stations-featured" hidden></div>
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
    body.querySelector('[data-action="shuffle"]')?.addEventListener('click', shuffle);
    const input = body.querySelector('#stationsSearch');
    input?.addEventListener('input', scheduleSearch);
    body.querySelector('.stations-mode')?.addEventListener('click', (evt) => {
      const button = evt.target.closest('[data-mode]');
      if (button) setMode(button.dataset.mode);
    });
    body.querySelector('#stationsContent')?.addEventListener('click', onContentClick);
    body.querySelector('#stationsContent')?.addEventListener('scroll', onContentScroll, { passive: true, capture: true });
    body.querySelector('.stations-shell')?.addEventListener('scroll', onContentScroll, { passive: true });
    body.querySelector('#stationsRail')?.addEventListener('click', (evt) => {
      const button = evt.target.closest('[data-letter]');
      if (!button || button.disabled) return;
      state.letter = button.dataset.letter;
      state.offset = 0;
      const content = body.querySelector('#stationsContent');
      scrollToContentTop(content, 'smooth');
      load({ reset: true });
    });
    filters?.close();
    filters = mountStationsFilters({
      root: body.querySelector('#stationsFilters'),
      getMeta: () => state.meta,
      onChange: (next) => {
        state.country = next.country;
        state.genre = next.genre;
        state.offset = 0;
        load({ reset: true });
      },
    });
    filters.setState({
      country: state.country,
      genre: state.genre,
    });
    body.querySelector('#stationsFeatured')?.addEventListener('click', onFeaturedClick);
    renderHeader();
    renderRail();
    renderContent();
    renderFeaturedSection();
  }

  function renderHeader() {
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
          ? 'Still learning: ranking improves as more people listen'
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

  function loadingHead() {
    if (state.mode === 'search' && state.query) return '<strong>Searching stations…</strong>';
    if (state.mode === 'popular') return '<strong>Popular this month</strong><span>Loading stations…</span>';
    if (state.mode === 'community') return '<strong>Community Radios</strong><span>Loading stations…</span>';
    if (state.letter === 'all') return '<strong>All stations</strong><span>Loading stations…</span>';
    return `<strong>${escapeHtml(state.letter)}</strong><span>Loading stations…</span>`;
  }

  function renderContent() {
    const content = body.querySelector('#stationsContent');
    if (!content) return;
    // The list markup is replaced below, so any expanded info panel or move
    // menu goes with it.
    closeMoveMenu();
    clearMoveTimers();
    moveState = null;
    inlineInfoEl = null;
    inlineInfoId = null;
    content.setAttribute('aria-busy', String(state.loading));
    if (state.tooShort) {
      content.innerHTML = `<div class="stations-empty"><p>Type at least 2 characters.</p></div>`;
      return;
    }
    if (state.loading && !state.rows.length) {
      content.innerHTML = `<div class="stations-section-head">${loadingHead()}</div><div class="stations-list">${Array.from({ length: 8 }, () => '<div class="stations-skeleton"></div>').join('')}</div>`;
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
    const canAdd = !!actions.canFavorite?.();
    const rows = state.rows.map((station, index) => stationsRow(station, {
      query: state.mode === 'search' ? state.query : '',
      mode: state.mode,
      algorithm: state.algorithm,
      canAdd,
      alreadyAdded: !!actions.isFavorited?.(station.id),
      priority: index < 10,
    })).join('');
    const atCap = state.mode !== 'popular' && state.rows.length >= MAX_ROWS;
    const endless = state.mode === 'popular' && state.nextOffset != null
      ? '<div class="stations-endless" aria-hidden="true"></div>'
      : '';
    const more = state.mode === 'popular'
      ? ''
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
      <div class="stations-list${state.loading ? ' is-loading' : ''}${animateRows ? ' is-entering' : ''}">${rows}${endless}</div>
      ${more}
    `;
    const scroller = scrollSurface(content);
    if (restoreScroll != null && scroller) scroller.scrollTop = restoreScroll;
    else if (animateRows) scrollToContentTop(content, 'smooth');
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

  function refreshAddedFlags() {
    body.querySelectorAll('[data-action="add"], [data-action="collection-add"]').forEach((button) => {
      const item = button.closest('[data-id], [data-uuid]');
      const id = item?.dataset.id ?? item?.dataset.uuid;
      const added = !!actions.isFavorited?.(id);
      button.classList.toggle('is-added', added);
      button.setAttribute('aria-pressed', String(added));
      if (!button.classList.contains('is-move')) {
        button.setAttribute('aria-label', added ? 'Already in favorites' : 'Add to favorites');
      }
    });
  }

  function emptyState() {
    const head = `<div class="stations-section-head">${sectionHead()}</div>`;
    if (state.mode === 'popular') {
      const filtered = state.country || state.genre;
      return filtered
        ? `${head}<div class="stations-empty"><p>No popular stations match these filters.</p><button type="button" class="stations-pill" data-action="clear-filters">Clear filters</button></div>`
        : `${head}<div class="stations-empty"><p>Popular is still warming up.</p><button type="button" class="stations-pill" data-action="browse-az">Browse A-Z</button></div>`;
    }
    if (state.mode === 'community') {
      const filtered = state.country || state.genre;
      return filtered
        ? `${head}<div class="stations-empty"><p>No community stations match these filters.</p><button type="button" class="stations-pill" data-action="clear-filters">Clear filters</button></div>`
        : `${head}<div class="stations-empty"><p>Community Radios is empty.</p><button type="button" class="stations-pill" data-action="browse-az">Browse A-Z</button></div>`;
    }
    if (state.mode === 'search') {
      return `${head}<div class="stations-empty"><p>No stations found for "${escapeHtml(state.query)}".</p><button type="button" class="stations-pill" data-action="clear-search">Clear search</button></div>`;
    }
    return `${head}<div class="stations-empty"><p>No stations match these filters.</p><button type="button" class="stations-pill" data-action="clear-filters">Clear filters</button></div>`;
  }

  // Heart → plus: adding a station makes the heart red; a moment later it
  // turns into a plus that opens a "move to list" menu. Ignored for two
  // seconds, the plus settles back into the red heart.
  function clearMoveTimers() {
    moveTimers.forEach(clearTimeout);
    moveTimers = [];
  }

  function settleHeart(button) {
    if (!button?.isConnected) return;
    button.innerHTML = HEART_ICON;
    button.classList.remove('is-move');
    button.setAttribute('aria-label', button.classList.contains('is-added') ? 'Already in favorites' : 'Add to favorites');
  }

  function startHeartFlow(button, station) {
    clearMoveTimers();
    moveState = { button, stationId: station.id };
    moveTimers.push(setTimeout(() => {
      if (!button.isConnected || moveMenu) return;
      button.innerHTML = PLUS_ICON;
      button.classList.add('is-move');
      button.setAttribute('aria-label', 'Move to another list');
    }, 350));
    moveTimers.push(setTimeout(() => {
      if (moveMenu) return;
      settleHeart(button);
      moveState = null;
    }, 2350));
  }

  function handleAdd(button, station) {
    const id = station?.id;
    if (!id) return;
    if (moveState?.stationId === id && button.classList.contains('is-move')) {
      openMoveMenu(button, station);
      return;
    }
    const wasAdded = !!actions.isFavorited?.(id);
    clearMoveTimers();
    moveState = null;
    button.classList.remove('heart-pop');
    void button.offsetWidth;
    button.classList.add('heart-pop');
    button.addEventListener('animationend', () => button.classList.remove('heart-pop'), { once: true });
    actions.onAdd?.(station);
    if (wasAdded) {
      settleHeart(button);
      return;
    }
    // Optimistic red until refreshAddedFlags confirms it.
    button.classList.add('is-added');
    button.setAttribute('aria-pressed', 'true');
    startHeartFlow(button, station);
  }

  function closeMoveMenu() {
    if (!moveMenu) return;
    const { el, button, onSettled } = moveMenu;
    moveMenu = null;
    el.remove();
    document.removeEventListener('pointerdown', onMoveMenuOutside, true);
    document.removeEventListener('keydown', onMoveMenuKey, true);
    if (onSettled) onSettled();
    else settleHeart(button);
  }

  function onMoveMenuOutside(evt) {
    if (!moveMenu) return;
    if (moveMenu.el.contains(evt.target) || moveMenu.button.contains(evt.target)) return;
    closeMoveMenu();
  }

  function onMoveMenuKey(evt) {
    if (evt.key !== 'Escape') return;
    evt.preventDefault();
    closeMoveMenu();
  }

  function positionMoveMenu(el, button) {
    const r = button.getBoundingClientRect();
    const mr = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.right - mr.width, window.innerWidth - mr.width - 8));
    const below = r.bottom + 6;
    const top = below + mr.height > window.innerHeight - 8
      ? Math.max(8, r.top - mr.height - 6)
      : below;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  async function openMoveMenu(button, station, onSettled = null) {
    clearMoveTimers();
    let lists = [];
    try { lists = (await data.getUserLists?.()) ?? []; } catch { lists = []; }
    if (!button.isConnected) return;
    closeMoveMenu();
    const activeId = actions.getFavoriteList?.()?.id ?? null;
    const el = document.createElement('div');
    el.className = 'stations-move-menu';
    el.setAttribute('role', 'menu');
    el.innerHTML = `
      <div class="stations-move-menu-head">Move to list</div>
      ${lists.map((list) => `
        <button type="button" class="stations-move-item${list.id === activeId ? ' is-current' : ''}" data-list-id="${escapeHtml(list.id)}" role="menuitem"${list.id === activeId ? ' aria-current="true"' : ''}>
          <span class="stations-move-check" aria-hidden="true">${list.id === activeId ? '✓' : ''}</span>
          <span class="stations-move-name">${escapeHtml(list.name)}</span>
        </button>`).join('')}
    `;
    if (!lists.length) el.insertAdjacentHTML('beforeend', '<p class="stations-move-empty">No lists yet.</p>');
    document.body.appendChild(el);
    moveMenu = { el, button, station, onSettled };
    positionMoveMenu(el, button);
    el.addEventListener('click', async (evt) => {
      const item = evt.target.closest('[data-list-id]');
      if (!item || item.classList.contains('is-current')) return;
      const target = moveMenu;
      await actions.onMove?.(station, item.dataset.listId);
      if (moveMenu === target) closeMoveMenu();
    });
    setTimeout(() => {
      document.addEventListener('pointerdown', onMoveMenuOutside, true);
      document.addEventListener('keydown', onMoveMenuKey, true);
    }, 0);
  }

  // Inline info: expanding a row (or a Discover tile) opens the station info
  // underneath it instead of the player's bottom sheet. One panel at a time.
  function closeInlineInfo() {
    if (inlineInfoEl?.isConnected) inlineInfoEl.remove();
    inlineInfoEl = null;
    inlineInfoId = null;
    body.querySelectorAll('[data-action="info"], [data-action="collection-info"]')
      .forEach((btn) => btn.setAttribute('aria-expanded', 'false'));
    body.querySelectorAll('.is-info-open').forEach((el) => el.classList.remove('is-info-open'));
  }

  function toggleInlineInfo(anchor, station) {
    const id = String(station?.id ?? '');
    if (!id) return;
    if (inlineInfoId === id) {
      closeInlineInfo();
      return;
    }
    closeInlineInfo();
    inlineInfoEl = createInlineStationInfo(station, { onClose: closeInlineInfo });
    anchor.after(inlineInfoEl);
    anchor.classList.add('is-info-open');
    inlineInfoId = id;
    anchor.querySelector('[data-action="info"], [data-action="collection-info"]')
      ?.setAttribute('aria-expanded', 'true');
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
      toggleInlineInfo(row, station);
      return;
    }
    if (button?.dataset.action === 'add') {
      handleAdd(button, station);
      return;
    }
    if (button?.dataset.action === 'play' || !button) {
      flashElement(row);
      if (state.nowPlayingId === station.id && actions.togglePlay) actions.togglePlay();
      else actions.onPlay?.(station);
    }
  }

  function isMobileLayout() {
    return matchMedia('(max-width: 699px)').matches;
  }

  function listScrollContainer(content) {
    return content?.querySelector(':scope > .stations-list') ?? content;
  }

  // Desktop scrolls the inset list; on phones the whole panel is the scroll
  // surface so the featured lists can stay stacked above the station list.
  function scrollSurface(content) {
    if (!content) return null;
    if (isMobileLayout()) return content.closest('.stations-shell') ?? content;
    return listScrollContainer(content);
  }

  function scrollToContentTop(content, behavior = 'auto') {
    if (!content) return;
    if (isMobileLayout()) {
      const shell = content.closest('.stations-shell');
      if (!shell) return;
      const header = shell.querySelector('.stations-header');
      const delta = content.getBoundingClientRect().top - shell.getBoundingClientRect().top;
      const top = shell.scrollTop + delta - (header?.offsetHeight ?? 0);
      shell.scrollTo({ top: Math.max(0, top), behavior });
      return;
    }
    listScrollContainer(content)?.scrollTo({ top: 0, behavior });
  }

  function onContentScroll() {
    if (state.view !== 'stations' || state.mode !== 'popular') return;
    if (state.loading || state.nextOffset == null) return;
    const content = body.querySelector('#stationsContent');
    if (!content) return;
    const scroller = scrollSurface(content);
    if (!scroller) return;
    if (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 240) {
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
    state.letter = 'all';
    state.offset = 0;
    filters?.setState({ country: '', genre: '' });
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
      if (!reset) state.restoreScroll = scrollSurface(content)?.scrollTop ?? null;
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
      });
      if (station) actions.onPlay?.(station);
      else actions.toast?.('No station matches these filters.');
    } catch {
      actions.toast?.('No station matches these filters.');
    }
  }

  function isCollectionSaved(slug) {
    return !!actions.isCollectionSaved?.(slug);
  }

  function syncCollectionButtons(slug, { saved = isCollectionSaved(slug), saving = false } = {}) {
    body.querySelectorAll('[data-action="save-collection"]').forEach((button) => {
      if (button.dataset.slug !== slug) return;
      syncCollectionSaveButton(button, { saved, saving });
    });
  }

  async function saveCollection(button) {
    const slug = button?.dataset.slug;
    if (!slug) return;
    if (isCollectionSaved(slug)) {
      actions.toast?.('This collection is already in your lists.');
      return;
    }
    const list = normaliseDiscover(state.discover).lists.find((item) => item.slug === slug);
    if (!list) return;
    syncCollectionButtons(slug, { saved: false, saving: true });
    const result = await actions.onSaveCollection?.(list);
    if (result?.ok) {
      syncCollectionButtons(slug, { saved: true, saving: false });
      return;
    }
    syncCollectionButtons(slug, { saved: isCollectionSaved(slug), saving: false });
  }

  function discoverShell(title, backAction, contentHtml, { list = null } = {}) {
    closeMoveMenu();
    clearMoveTimers();
    moveState = null;
    inlineInfoEl = null;
    inlineInfoId = null;
    body.innerHTML = `
      <div class="stations-shell">
        <header class="stations-header">
          ${dragHandle()}
          <button type="button" class="stations-icon-btn" data-action="${backAction}" aria-label="Back">←</button>
          <div class="stations-header-copy">
            <p class="stations-kicker">Stations</p>
            <h2 class="stations-title" id="stationsTitle">${escapeHtml(title)}</h2>
          </div>
          <div class="stations-header-actions">
            ${list ? collectionSaveButton(list, { saved: isCollectionSaved(list.slug) }) : ''}
            <button type="button" class="stations-icon-btn" data-action="close" aria-label="Close Stations">${closeIcon()}</button>
          </div>
        </header>
        <div id="stationsContent" class="stations-content">${contentHtml}</div>
      </div>`;
    body.querySelector('[data-action="close"]')?.addEventListener('click', close);
    body.querySelector('.stations-header-actions [data-action="save-collection"]')?.addEventListener('click', (evt) => {
      evt.stopPropagation();
      saveCollection(evt.currentTarget);
    });
    body.querySelector(`[data-action="${backAction}"]`)?.addEventListener('click', () => {
      if (backAction === 'back-discover') renderDiscoverView();
      else backToStations();
    });
    const content = body.querySelector('#stationsContent');
    content?.addEventListener('click', onDiscoverClick);
    mountLogoBehavior(content);
    queueMicrotask(() => body.querySelector(`[data-action="${backAction}"]`)?.focus());
  }

  // Featured editorial lists above the search bar. The dashboard can feature
  // any number of lists; each visit shows four random picks from that pool.
  async function renderFeaturedSection() {
    const host = body.querySelector('#stationsFeatured');
    if (!host) return;
    if (!state.discover) {
      try { state.discover = (await data.loadDiscover?.({})) ?? null; } catch { state.discover = null; }
    }
    if (!host.isConnected || state.view !== 'stations') return;
    const pool = featuredLists(normaliseDiscover(state.discover).lists);
    if (!pool.length) {
      state.featuredSlugs = null;
      host.hidden = true;
      host.innerHTML = '';
      return;
    }
    let lists = [];
    if (Array.isArray(state.featuredSlugs)) {
      const bySlug = new Map(pool.map((list) => [list.slug, list]));
      lists = state.featuredSlugs.map((slug) => bySlug.get(slug)).filter(Boolean);
    }
    if (!lists.length) lists = pickFeaturedLists(pool, 4);
    // Keep the current picks stable when the section re-renders, but replace
    // any picks that disappeared from the pool so the row stays full.
    if (lists.length < Math.min(4, pool.length)) {
      const chosen = new Set(lists.map((list) => list.slug));
      lists = lists.concat(pool.filter((list) => !chosen.has(list.slug)).slice(0, Math.min(4, pool.length) - lists.length));
    }
    state.featuredSlugs = lists.map((list) => list.slug);
    host.hidden = false;
    host.innerHTML = `
      <div class="stations-collection-grid stations-featured-grid">${lists.map((list) => collectionCard(list, { saved: isCollectionSaved(list.slug) })).join('')}</div>
      <div class="stations-featured-actions">
        <button type="button" class="stations-pill stations-discover-btn" data-action="discover-more">${discoverIcon()}<span>Discover more collections</span></button>
        <button type="button" class="stations-submit-link" data-action="submit-list">Suggest a collection</button>
      </div>
    `;
    // Logo slots only swap their initials for artwork once the behavior is
    // mounted (same as the Discover collection grids).
    mountLogoBehavior(host);
  }

  function onFeaturedClick(evt) {
    const save = evt.target.closest('[data-action="save-collection"]');
    if (save) {
      saveCollection(save);
      return;
    }
    const collection = evt.target.closest('[data-collection]');
    if (collection) {
      // A featured card is a detour from the Stations page: its back button
      // returns there, not to Discover.
      openCollection(collection.dataset.collection, { backAction: 'back' });
      return;
    }
    if (evt.target.closest('[data-action="discover-more"]')) {
      openDiscover();
      return;
    }
    if (evt.target.closest('[data-action="submit-list"]')) {
      openPlaylistPicker();
    }
  }

  function renderDiscoverView() {
    state.view = 'discover';
    state.collection = null;
    if (!state.discover) {
      discoverShell('Discover', 'back', renderDiscoverUnavailable());
      return;
    }
    const lists = normaliseDiscover(state.discover).lists;
    discoverShell('Discover', 'back', renderDiscover({ lists, isSaved: isCollectionSaved }));
    applyNowPlaying();
    refreshAddedFlags();
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

  function openCollection(slug, { backAction = 'back-discover' } = {}) {
    const list = normaliseDiscover(state.discover).lists.find((item) => item.slug === slug);
    if (!list) return;
    // Leaving the stations list: stop an in-flight browse request, otherwise
    // its late response paints Popular into the collection's content slot.
    controller?.abort();
    loadToken++;
    state.loading = false;
    state.view = 'discover';
    state.collection = list;
    discoverShell(list.title, backAction, renderCollection({ list }), { list });
    applyNowPlaying();
    refreshAddedFlags();
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
      submitterName: '',
      submitterContact: '',
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
    const submitterName = body.querySelector('#playlistSubmitterName')?.value.trim() ?? '';
    const submitterContact = body.querySelector('#playlistSubmitterContact')?.value.trim() ?? '';
    if (title.length < 2 || title.length > 60) {
      picker.title = title;
      picker.note = note;
      picker.submitterName = submitterName;
      picker.submitterContact = submitterContact;
      picker.error = 'Title must be 2 to 60 characters.';
      renderPlaylistPicker();
      return;
    }
    if (submitterName.length < 2 || submitterName.length > 60) {
      picker.title = title;
      picker.note = note;
      picker.submitterName = submitterName;
      picker.submitterContact = submitterContact;
      picker.error = 'Your name must be 2 to 60 characters.';
      renderPlaylistPicker();
      return;
    }
    picker.title = title;
    picker.note = note;
    picker.submitterName = submitterName;
    picker.submitterContact = submitterContact;
    picker.submitting = true;
    picker.error = '';
    renderPlaylistPicker();
    try {
      await data.submitPlaylist?.({
        title,
        note,
        submitterName,
        submitterContact,
        stationUuids: picker.selected.stations.map((station) => station.id),
      });
      if (!state.playlistPicker) return;
      state.playlistPicker.success = true;
      state.playlistPicker.submitting = false;
      renderPlaylistPicker();
    } catch (err) {
      if (!state.playlistPicker) return;
      state.playlistPicker.submitting = false;
      state.playlistPicker.error = err?.message || 'Could not submit the collection.';
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
    const save = evt.target.closest('[data-action="save-collection"]');
    if (save) {
      saveCollection(save);
      return;
    }
    const collection = evt.target.closest('[data-collection]');
    if (collection) {
      openCollection(collection.dataset.collection);
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
    else if (name === 'collection-info') toggleInlineInfo(action.closest('.stations-collection-tile'), station);
    else if (name === 'collection-add') handleAdd(action, station);
  }

  function browseAll() {
    state.view = 'stations';
    state.collection = null;
    state.mode = 'az';
    state.query = '';
    state.letter = 'all';
    state.country = '';
    state.genre = '';
    state.offset = 0;
    shell();
    filters?.setState({ country: '', genre: '' });
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

  function setPanelPosition(x, y) {
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const left = Math.max(0, Math.min(window.innerWidth - width, x));
    const top = Math.max(0, Math.min(window.innerHeight - height, y));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.transform = 'none';
    panelPosition = { left, top };
  }

  function applyPanelSize(width, height) {
    const rect = panel.getBoundingClientRect();
    const inlineLeft = Number.parseFloat(panel.style.left);
    const inlineTop = Number.parseFloat(panel.style.top);
    const left = Number.isFinite(inlineLeft) ? inlineLeft : rect.left;
    const top = Number.isFinite(inlineTop) ? inlineTop : rect.top;
    const next = resolvePanelSize({
      startWidth: width,
      startHeight: height,
      left,
      top,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });
    panel.style.width = `${next.width}px`;
    panel.style.height = `${next.height}px`;
    panel.style.maxHeight = 'none';
    panelSize = next;
    return next;
  }

  async function applyPosition() {
    if (isAppRegime()) {
      panel.style.left = '';
      panel.style.top = '';
      panel.style.width = '';
      panel.style.height = '';
      panel.style.maxHeight = '';
      panel.style.transform = '';
      return;
    }
    if (!panelPosition || !panelSize) {
      const [savedPosition, savedSize] = await Promise.all([
        panelPosition ? Promise.resolve(panelPosition) : storage.getPref('stationsPanelPos', null).catch(() => null),
        panelSize ? Promise.resolve(panelSize) : storage.getPref('stationsPanelSize', null).catch(() => null),
      ]);
      panelPosition = panelPosition ?? savedPosition;
      panelSize = panelSize ?? savedSize;
    }
    if (panelSize?.width && panelSize?.height) {
      applyPanelSize(panelSize.width, panelSize.height);
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
    clearTimeout(openSettleTimer);
    openSettleTimer = null;
    cancelSnap(panel);
    evt.preventDefault();
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
      const target = snapPanel(panel, {
        x: panel.offsetLeft,
        y: panel.offsetTop,
        setPosition: (nx, ny) => {
          panel.style.left = `${nx}px`;
          panel.style.top = `${ny}px`;
        },
      });
      panelPosition = { left: target.x, top: target.y };
      storage.setPref('stationsPanelPos', panelPosition).catch(() => {});
    }

    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up, { once: true });
  }

  function startResize(evt) {
    if (isAppRegime() || evt.button !== 0) return;
    evt.preventDefault();
    clearTimeout(openSettleTimer);
    openSettleTimer = null;
    cancelSnap(panel);

    const rect = panel.getBoundingClientRect();
    // A resize starts from the visual top-left corner. Turning the centred
    // CSS position into fixed coordinates keeps the handle under the pointer
    // instead of growing the panel in both directions.
    panel.style.transform = 'none';
    panel.style.left = `${rect.left}px`;
    panel.style.top = `${rect.top}px`;
    panel.style.width = `${rect.width}px`;
    panel.style.height = `${rect.height}px`;
    panel.style.maxHeight = 'none';
    panelPosition = { left: rect.left, top: rect.top };
    panelSize = { width: rect.width, height: rect.height };

    const pointerId = evt.pointerId;
    const startX = evt.clientX;
    const startY = evt.clientY;
    panel.classList.add('is-resizing');
    document.body.style.cursor = 'nwse-resize';

    function move(event) {
      if (event.pointerId !== pointerId) return;
      const next = resolvePanelSize({
        startWidth: rect.width,
        startHeight: rect.height,
        deltaX: event.clientX - startX,
        deltaY: event.clientY - startY,
        left: rect.left,
        top: rect.top,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      });
      panel.style.width = `${next.width}px`;
      panel.style.height = `${next.height}px`;
      panelSize = next;
    }

    function end(event) {
      if (event && event.pointerId !== pointerId) return;
      panel.classList.remove('is-resizing');
      document.body.style.cursor = '';
      resizeHandle.removeEventListener('pointermove', move);
      resizeHandle.removeEventListener('pointerup', end);
      resizeHandle.removeEventListener('pointercancel', end);
      try { resizeHandle.releasePointerCapture(pointerId); } catch {}
      if (panelSize) storage.setPref('stationsPanelSize', panelSize).catch(() => {});
      if (panelPosition) storage.setPref('stationsPanelPos', panelPosition).catch(() => {});
    }

    try { resizeHandle.setPointerCapture(pointerId); } catch {}
    resizeHandle.addEventListener('pointermove', move);
    resizeHandle.addEventListener('pointerup', end);
    resizeHandle.addEventListener('pointercancel', end);
  }

  resizeHandle.addEventListener('pointerdown', startResize);

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

  function scheduleOpenSettle() {
    clearTimeout(openSettleTimer);
    openSettleTimer = setTimeout(() => {
      openSettleTimer = null;
      if (!isOpen || isAppRegime()) return;
      const rect = panel.getBoundingClientRect();
      const target = snapPanel(panel, {
        x: rect.left,
        y: rect.top,
        setPosition: setPanelPosition,
      });
      if (Math.abs(target.x - rect.left) > 0.5 || Math.abs(target.y - rect.top) > 0.5) {
        storage.setPref('stationsPanelPos', { left: target.x, top: target.y }).catch(() => {});
      }
    }, 300);
  }

  function open({ query = '' } = {}) {
    const firstOpen = !isOpen;
    previousFocus = document.activeElement;
    state.tooShort = false;
    if (firstOpen || state.view !== 'stations') {
      state.view = 'stations';
      // A new visit rotates the four featured picks from the whole pool.
      state.featuredSlugs = null;
      if (firstOpen) {
        isOpen = true;
        panel.classList.add('is-open');
        panel.setAttribute('aria-hidden', 'false');
        document.body.classList.add('stations-overlay-open');
        document.addEventListener('keydown', onDocumentKeydown);
        window.dispatchEvent(new CustomEvent('rd:page-open', { detail: { id: 'stations' } }));
      }
      shell();
      Promise.resolve(applyPosition()).finally(() => {
        // Settle after the slide-in, using the same rubber snap as a drop.
        if (isOpen && firstOpen) scheduleOpenSettle();
      });
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
    clearTimeout(openSettleTimer);
    openSettleTimer = null;
    isOpen = false;
    loadToken++;
    controller?.abort();
    state.loading = false;
    state.tooShort = false;
    state.playlistPicker = null;
    closeMoveMenu();
    clearMoveTimers();
    moveState = null;
    filters?.close();
    document.removeEventListener('keydown', onDocumentKeydown);
    panel.classList.remove('is-open');
    panel.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('stations-overlay-open');
    if (previousFocus?.focus) previousFocus.focus();
  }

  panel.addEventListener('pointerdown', (evt) => {
    if (evt.target.closest('.stations-header')) startDrag(evt);
  });
  panel.addEventListener('keydown', onKeydown);

  return {
    open,
    close,
    isOpen: () => isOpen,
    openMoveMenuFor(anchor, station, onSettled) {
      return openMoveMenu(anchor, station, onSettled);
    },
    focusSearch() {
      body.querySelector('#stationsSearch')?.focus();
    },
    setNowPlaying(id) {
      state.nowPlayingId = id ?? null;
      applyNowPlaying();
    },
    refreshCollectionSaveFlags() {
      body.querySelectorAll('[data-action="save-collection"]').forEach((button) => {
        syncCollectionSaveButton(button, { saved: isCollectionSaved(button.dataset.slug) });
      });
    },
    refreshAddedFlags,
  };
}
