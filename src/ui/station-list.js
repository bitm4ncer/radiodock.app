// Renders a list of stations into #favoritesList.
// - Click row → play.
// - Optional remove button (only when editable=true, i.e. not the community list).
// - Long-press (touch) or drag-handle (mouse) reorder via Pointer Events.
//   HTML5 drag-and-drop was replaced because it required imprecise long-holds
//   on iOS Safari, gave no auto-scroll near edges, and had no haptic feedback.

import { renderLogoSlot, mountLogoBehavior } from './station-logo.js';
import { mountNowPlayingHover } from './nowplaying-hover.js';
import { detectStandalone } from '../platform.js';
import { isElectron } from './electron-bridge.js';

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

function stationRow(station, { activeId, removable, reorderable }) {
  const isActive = station.id === activeId;
  const removeBtn = removable
    ? `<button type="button" class="btn-icon btn-remove" title="Remove from list" aria-label="Remove station">
         <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>
       </button>`
    : '';
  const dragHandle = reorderable
    ? `<span class="btn-drag" title="Drag to reorder" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.6" fill="currentColor"/><circle cx="15" cy="6" r="1.6" fill="currentColor"/><circle cx="9" cy="12" r="1.6" fill="currentColor"/><circle cx="15" cy="12" r="1.6" fill="currentColor"/><circle cx="9" cy="18" r="1.6" fill="currentColor"/><circle cx="15" cy="18" r="1.6" fill="currentColor"/></svg></span>`
    : '';
  return `
    <div class="station-item${isActive ? ' playing' : ''}" data-id="${escapeHtml(station.id)}">
      ${renderLogoSlot(station, { size: 'sm' })}
      <div class="station-item-info">
        <div class="station-item-name">${escapeHtml(station.name ?? '')}</div>
        <div class="station-item-country">${escapeHtml(station.countrycode ?? '')}</div>
      </div>
      ${(removable || reorderable) ? `<div class="station-item-actions">${removeBtn}${dragHandle}</div>` : ''}
    </div>
  `;
}

const LONG_PRESS_MS = 300;
const MOVE_THRESHOLD_PX = 10;
const EDGE_ZONE_PX = 60;
const MAX_SCROLL_PX_PER_FRAME = 12;

export function mountStationList({ container, listId = null }) {
  const listEl = typeof container === 'string' ? document.getElementById(container) : container;
  // Tab layout (mobile / installed PWA / Electron) drives the filter from the
  // active list tab's funnel; the desktop browser keeps its own inline button.
  const tabbedFilter = matchMedia('(max-width: 699px)').matches || detectStandalone() || isElectron();
  // Look up the empty-state placeholder as a child of this list's
  // container, not via a global #emptyState ID. Lets the component be
  // instantiated multiple times (one per page) inside the mobile
  // lists-carousel without two instances fighting over the same node.
  const emptyEl = listEl?.querySelector('.empty-state') ?? null;

  let stations = [];
  let activeId = null;
  let removable = false;
  let reorderable = false;
  let clickCb = null;
  let removeCb = null;
  let reorderCb = null;
  let rowsHost = null;

  // List quick-filter (client-side, current list only — distinct from the
  // global search). Collapsed to a tiny funnel pill; expands to an input with
  // small dot-toggles picking which fields to match.
  let filterBar = null;
  let filterInput = null;
  let filterQuery = '';
  const filterScopes = { name: true, genre: false, country: false };

  // Reorder state
  let pressTimer = null;
  let pressedRow = null;
  let pointerStartX = 0;
  let pointerStartY = 0;
  let activePointerId = null;
  let dragSrcRow = null;
  let scrollContainer = null;
  let autoScrollRAF = null;
  let autoScrollSpeed = 0;
  let suppressNextClick = false;

  function findScrollContainer(el) {
    let node = el.parentElement;
    while (node && node !== document.body) {
      const style = getComputedStyle(node);
      const oy = style.overflowY;
      if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight) {
        return node;
      }
      node = node.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  function startAutoScroll() {
    if (autoScrollRAF) return;
    const tick = () => {
      if (autoScrollSpeed && scrollContainer) {
        scrollContainer.scrollBy(0, autoScrollSpeed);
      }
      autoScrollRAF = requestAnimationFrame(tick);
    };
    autoScrollRAF = requestAnimationFrame(tick);
  }

  function stopAutoScroll() {
    if (autoScrollRAF) {
      cancelAnimationFrame(autoScrollRAF);
      autoScrollRAF = null;
    }
    autoScrollSpeed = 0;
  }

  function activateDrag(row) {
    dragSrcRow = row;
    row.classList.add('dragging');
    rowsHost.classList.add('reorder-active');
    scrollContainer = findScrollContainer(row);
    try { navigator.vibrate?.(15); } catch {}
    startAutoScroll();
  }

  function moveDrag(y) {
    if (!dragSrcRow) return;
    const siblings = Array.from(rowsHost.children).filter((el) => el !== dragSrcRow);
    for (const sib of siblings) {
      const r = sib.getBoundingClientRect();
      if (y >= r.top && y <= r.bottom) {
        const mid = r.top + r.height / 2;
        if (y < mid) {
          if (sib.previousElementSibling !== dragSrcRow) rowsHost.insertBefore(dragSrcRow, sib);
        } else {
          if (sib.nextElementSibling !== dragSrcRow) rowsHost.insertBefore(dragSrcRow, sib.nextElementSibling);
        }
        break;
      }
    }

    const isDoc = scrollContainer === document.scrollingElement || scrollContainer === document.documentElement;
    const cRect = isDoc ? null : scrollContainer.getBoundingClientRect();
    const top = isDoc ? 0 : cRect.top;
    const bottom = isDoc ? window.innerHeight : cRect.bottom;
    // On mobile the page scrolls under a fixed bottom player (~160 px tall).
    // Stop the auto-scroll edge zone above that overlap so we don't trigger
    // scroll while the finger is still over the player card.
    const playerOverlap = isDoc && matchMedia('(max-width: 699px)').matches ? 160 : 0;

    const distTop = y - top;
    const distBottom = bottom - playerOverlap - y;

    if (distTop < EDGE_ZONE_PX) {
      autoScrollSpeed = -Math.ceil((EDGE_ZONE_PX - distTop) / EDGE_ZONE_PX * MAX_SCROLL_PX_PER_FRAME);
    } else if (distBottom < EDGE_ZONE_PX) {
      autoScrollSpeed = Math.ceil((EDGE_ZONE_PX - distBottom) / EDGE_ZONE_PX * MAX_SCROLL_PX_PER_FRAME);
    } else {
      autoScrollSpeed = 0;
    }
  }

  function commitDrag() {
    const orderedIds = Array.from(rowsHost.querySelectorAll('[data-id]')).map((el) => el.dataset.id);
    cleanupDrag();
    // The synthesised click after a touch reorder would otherwise hit the
    // station-row click handler and start playback. Swallow exactly one
    // click; later real taps still work.
    suppressNextClick = true;
    setTimeout(() => { suppressNextClick = false; }, 100);
    reorderCb?.(orderedIds);
  }

  function cleanupDrag() {
    stopAutoScroll();
    if (dragSrcRow) {
      dragSrcRow.classList.remove('dragging');
      dragSrcRow = null;
    }
    rowsHost?.classList.remove('reorder-active');
    activePointerId = null;
    pressedRow = null;
    scrollContainer = null;
  }

  function cancelPress() {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
    pressedRow = null;
  }

  function ensureRowsHost() {
    if (rowsHost) return rowsHost;
    rowsHost = document.createElement('div');
    rowsHost.className = 'station-list-rows';
    listEl.append(rowsHost);
    mountLogoBehavior(rowsHost);
    // Desktop hover → live now-playing preview under the station name.
    mountNowPlayingHover(rowsHost, (row) => stations.find((s) => s.id === row.dataset.id) ?? null);

    rowsHost.addEventListener('click', (evt) => {
      if (suppressNextClick) {
        evt.stopPropagation();
        evt.preventDefault();
        return;
      }
      const removeBtn = evt.target.closest('.btn-remove');
      if (removeBtn) {
        evt.stopPropagation();
        const row = removeBtn.closest('[data-id]');
        if (row) removeCb?.(row.dataset.id);
        return;
      }
      const row = evt.target.closest('[data-id]');
      if (!row) return;
      const station = stations.find((s) => s.id === row.dataset.id);
      if (station) clickCb?.(station);
    });

    rowsHost.addEventListener('pointerdown', (evt) => {
      if (!reorderable) return;
      if (evt.button !== undefined && evt.button !== 0) return;
      // Ignore additional fingers while a drag/press is in flight.
      if (dragSrcRow || pressedRow) return;
      if (evt.target.closest('.btn-remove')) return;

      const row = evt.target.closest('[data-id]');
      if (!row) return;

      const isHandle = !!evt.target.closest('.btn-drag');
      const isTouch = evt.pointerType === 'touch';

      // Mouse on row body stays a pure click-to-play; only the handle starts
      // a drag on desktop.
      if (!isTouch && !isHandle) return;

      pointerStartX = evt.clientX;
      pointerStartY = evt.clientY;
      activePointerId = evt.pointerId;
      pressedRow = row;

      if (isHandle) {
        activateDrag(row);
        try { rowsHost.setPointerCapture(evt.pointerId); } catch {}
        evt.preventDefault();
      } else {
        pressTimer = setTimeout(() => {
          pressTimer = null;
          if (pressedRow !== row) return;
          activateDrag(row);
          try { rowsHost.setPointerCapture(activePointerId); } catch {}
        }, LONG_PRESS_MS);
      }
    });

    rowsHost.addEventListener('pointermove', (evt) => {
      if (evt.pointerId !== activePointerId) return;
      if (pressTimer) {
        const dx = Math.abs(evt.clientX - pointerStartX);
        const dy = Math.abs(evt.clientY - pointerStartY);
        if (dx > MOVE_THRESHOLD_PX || dy > MOVE_THRESHOLD_PX) {
          cancelPress();
          activePointerId = null;
        }
        return;
      }
      if (dragSrcRow) {
        evt.preventDefault();
        moveDrag(evt.clientY);
      }
    }, { passive: false });

    const onEnd = (evt) => {
      if (activePointerId === null || evt.pointerId !== activePointerId) return;
      cancelPress();
      if (dragSrcRow) {
        commitDrag();
      } else {
        activePointerId = null;
      }
    };
    rowsHost.addEventListener('pointerup', onEnd);
    rowsHost.addEventListener('pointercancel', onEnd);

    return rowsHost;
  }

  function render() {
    // A reorder in flight would dangle on dragSrcRow after innerHTML wipes
    // the DOM. In practice this path is only hit on list-switch or
    // stationchange, both of which already implicitly end the gesture.
    if (dragSrcRow || pressedRow) cleanupDrag();
    if (!stations.length) {
      if (emptyEl) emptyEl.style.display = '';
      if (rowsHost) rowsHost.remove();
      rowsHost = null;
      if (filterBar) filterBar.style.display = 'none';
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';
    if (filterBar) filterBar.style.display = '';
    const host = ensureRowsHost();
    host.innerHTML = stations
      .map((s) => stationRow(s, { activeId, removable, reorderable }))
      .join('');
    applyFilter();
  }

  // ---- List quick-filter ----
  const FILTER_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg>';

  function buildFilterBar() {
    if (!listEl) return;
    filterBar = document.createElement('div');
    filterBar.className = 'list-filter';
    filterBar.style.display = 'none';
    // No internal trigger — the funnel lives in the active list tab (tab
    // layout) or next to the "Community Radios" title (desktop). Collapsed the
    // bar takes no space; it reveals the input pill in place when toggled.
    filterBar.innerHTML = `
      <div class="list-filter__pill">
        <input type="text" class="list-filter__input" data-role="input" placeholder="Filter this list…" aria-label="Filter this list" />
        <div class="list-filter__scopes" data-role="scopes">
          <button type="button" class="list-filter__scope is-active" data-scope="name">name</button>
          <button type="button" class="list-filter__scope" data-scope="genre">genre</button>
          <button type="button" class="list-filter__scope" data-scope="country">country</button>
        </div>
      </div>`;
    if (listEl.parentNode) listEl.parentNode.insertBefore(filterBar, listEl);
    else listEl.prepend(filterBar);
    filterInput = filterBar.querySelector('[data-role="input"]');

    const collapse = () => {
      filterBar.classList.remove('is-expanded');
      if (filterQuery) { filterQuery = ''; filterInput.value = ''; applyFilter(); }
    };
    const expand = () => { filterBar.classList.add('is-expanded'); filterInput.focus(); };
    const toggleOpen = () => { filterBar.classList.contains('is-expanded') ? collapse() : expand(); };

    if (tabbedFilter) {
      // Tab layout: the active list tab's funnel drives this list's filter.
      window.addEventListener('rd:list-filter-toggle', (e) => {
        if (e.detail?.id === listId) toggleOpen();
      });
    } else if (listId === null) {
      // Desktop: the single #favoritesList instance (listId null) owns the
      // shared list-header, so only it injects the funnel left of the dropdown.
      // (The carousel's per-list instances have a listId and stay inert here —
      // they're hidden in the desktop layout anyway.)
      const dropdown = document.querySelector('.list-header .list-dropdown');
      if (dropdown?.parentNode) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'list-header__filter';
        btn.setAttribute('aria-label', 'Filter this list');
        btn.title = 'Filter this list';
        btn.innerHTML = FILTER_ICON;
        dropdown.parentNode.insertBefore(btn, dropdown);
        btn.addEventListener('click', toggleOpen);
      }
    }
    filterInput.addEventListener('input', () => { filterQuery = filterInput.value; applyFilter(); });
    filterInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') collapse(); });
    for (const btn of filterBar.querySelectorAll('[data-scope]')) {
      btn.addEventListener('click', () => {
        const s = btn.dataset.scope;
        // Keep at least one scope active so the filter never matches nothing.
        if (filterScopes[s] && Object.values(filterScopes).filter(Boolean).length === 1) return;
        filterScopes[s] = !filterScopes[s];
        btn.classList.toggle('is-active', filterScopes[s]);
        applyFilter();
        filterInput.focus();
      });
    }
  }

  function stationMatches(st, q) {
    if (filterScopes.name && String(st?.name ?? '').toLowerCase().includes(q)) return true;
    if (filterScopes.genre && (Array.isArray(st?.tags) ? st.tags.join(' ') : '').toLowerCase().includes(q)) return true;
    if (filterScopes.country && String(st?.countrycode ?? '').toLowerCase().includes(q)) return true;
    return false;
  }

  function applyFilter() {
    if (!rowsHost) return;
    const q = filterQuery.trim().toLowerCase();
    const byId = new Map(stations.map((s) => [String(s.id), s]));
    let visible = 0;
    for (const row of rowsHost.children) {
      if (row.classList.contains('list-filter__empty')) continue;
      const match = !q || stationMatches(byId.get(row.dataset.id), q);
      row.classList.toggle('is-filtered-out', !match);
      if (match) visible++;
    }
    let hint = rowsHost.querySelector('.list-filter__empty');
    if (q && visible === 0) {
      if (!hint) {
        hint = document.createElement('div');
        hint.className = 'list-filter__empty';
        hint.textContent = 'No matches in this list';
        rowsHost.appendChild(hint);
      }
    } else if (hint) {
      hint.remove();
    }
  }

  buildFilterBar();

  return {
    setStations(next, opts = {}) {
      stations = next ?? [];
      // `editable` is shorthand for both — kept for back-compat with callers
      // that haven't migrated to the per-affordance flags.
      if ('editable' in opts) {
        removable = !!opts.editable;
        reorderable = !!opts.editable;
      }
      if ('removable' in opts) removable = !!opts.removable;
      if ('reorderable' in opts) reorderable = !!opts.reorderable;
      render();
    },
    setActive(id) {
      const next = id ?? null;
      if (next === activeId) return;
      activeId = next;
      // Surgically move the .playing highlight instead of re-rendering the
      // whole list. A full innerHTML rebuild here would destroy the hover
      // now-playing slot that nowplaying-hover.js injects into a row, so the
      // metadata would flash out and back in whenever a station is selected.
      if (!rowsHost) return;
      const want = activeId == null ? null : String(activeId);
      for (const row of rowsHost.children) {
        row.classList.toggle('playing', want != null && row.dataset.id === want);
      }
    },
    onClick(cb) { clickCb = cb; },
    onRemove(cb) { removeCb = cb; },
    onReorder(cb) { reorderCb = cb; },
  };
}
