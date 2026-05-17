// Horizontal scroll-snap carousel of station lists for mobile. Each
// list is its own .list-page; the container has scroll-snap-type:
// x mandatory so horizontal swipes snap to neighbour lists with iOS-
// native feel (zero JS for the actual gesture). Tab clicks trigger
// programmatic smooth-scroll via scrollIntoView.
//
// Owns N independent mountStationList instances — one per page — all
// wired to identical onClick/onRemove/onReorder callbacks. The
// station-list module was made multi-instance-safe (its emptyEl
// lookup is now per-container) so this just works.

import { mountStationList } from './station-list.js';

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

export function mountListsCarousel({ root }) {
  if (!root) {
    return {
      setLists() {}, setCurrent() {}, setStations() {},
      setActiveStation() {}, onCurrentChange() {},
      onClick() {}, onRemove() {}, onReorder() {},
    };
  }

  let lists = [];
  let currentId = null;
  let activeStationId = null;
  let clickCb = null;
  let removeCb = null;
  let reorderCb = null;
  let currentChangeCb = null;

  // listId → { pageEl, stationList }
  const pages = new Map();

  // Suppress the scroll-listener while we're programmatically scrolling
  // to a tab the user clicked — otherwise the scroll event fires for
  // every intermediate position and emits stale onCurrentChange.
  let suppressScrollSync = false;
  let suppressTimer = null;

  function ensurePage(list) {
    if (pages.has(list.id)) return pages.get(list.id);

    const pageEl = document.createElement('section');
    pageEl.className = 'list-page';
    pageEl.dataset.id = list.id;
    pageEl.innerHTML = `
      <div class="favorites-list" id="favoritesList-${escapeHtml(list.id)}">
        <div class="empty-state">
          <p>${list.readOnly ? 'No stations available.' : 'No stations yet.'}</p>
        </div>
      </div>`;
    root.append(pageEl);

    const listEl = pageEl.querySelector('.favorites-list');
    const sl = mountStationList({ container: listEl });
    sl.onClick((station) => clickCb?.(station, list.id));
    sl.onRemove((stationId) => removeCb?.(stationId, list.id));
    sl.onReorder((orderedIds) => reorderCb?.(orderedIds, list.id));
    sl.setStations(list.stations ?? [], { editable: !list.readOnly });
    sl.setActive(activeStationId);

    const entry = { pageEl, stationList: sl };
    pages.set(list.id, entry);
    return entry;
  }

  function reconcilePages() {
    const validIds = new Set(lists.map((l) => l.id));
    // Remove pages whose list disappeared.
    for (const [id, { pageEl }] of pages.entries()) {
      if (!validIds.has(id)) {
        pageEl.remove();
        pages.delete(id);
      }
    }
    // Create / update existing pages, in order.
    for (const list of lists) {
      const entry = ensurePage(list);
      entry.stationList.setStations(list.stations ?? [], { editable: !list.readOnly });
      entry.stationList.setActive(activeStationId);
      // Reorder DOM to match `lists` order — append moves existing nodes.
      root.append(entry.pageEl);
    }
  }

  function scrollToCurrent({ animate }) {
    if (!currentId) return;
    const entry = pages.get(currentId);
    if (!entry) return;
    suppressScrollSync = true;
    clearTimeout(suppressTimer);
    suppressTimer = setTimeout(() => {
      suppressScrollSync = false;
    }, animate ? 400 : 50);
    entry.pageEl.scrollIntoView({
      behavior: animate ? 'smooth' : 'auto',
      block: 'nearest',
      inline: 'start',
    });
  }

  function detectCurrentFromScroll() {
    if (suppressScrollSync) return;
    const pageWidth = root.clientWidth;
    if (!pageWidth) return;
    // Snap-by-half: the page whose left edge has scrolled past the
    // container's midpoint is "the current page". Math.round of
    // (scrollLeft / pageWidth) gives that index — switches at exactly
    // 50% past, which is when the eye also reads the new page as
    // dominant.
    const idx = Math.round(root.scrollLeft / pageWidth);
    const pageEl = root.children[idx];
    const id = pageEl?.dataset?.id;
    if (id && id !== currentId) {
      currentId = id;
      currentChangeCb?.(id);
    }
  }

  // Detect on every scroll frame (rAF-coalesced) instead of waiting
  // for scrollend / a debounce timer — the previous 80 ms wait felt
  // like a noticeable delay after the snap settled. The work is just
  // a class toggle, cheap to do every frame.
  let scrollRafQueued = false;
  root.addEventListener('scroll', () => {
    if (scrollRafQueued) return;
    scrollRafQueued = true;
    requestAnimationFrame(() => {
      scrollRafQueued = false;
      detectCurrentFromScroll();
    });
  }, { passive: true });

  return {
    setLists(next) {
      lists = next ?? [];
      reconcilePages();
      // After list-set, re-anchor the scroll to the current page so
      // adding/removing lists doesn't visually jolt the user.
      if (currentId && pages.has(currentId)) {
        scrollToCurrent({ animate: false });
      }
    },
    setCurrent(id, { animate = true } = {}) {
      if (currentId === id) return;
      currentId = id ?? null;
      scrollToCurrent({ animate });
    },
    setStations(listId, stations) {
      const entry = pages.get(listId);
      if (!entry) return;
      const list = lists.find((l) => l.id === listId);
      entry.stationList.setStations(stations ?? [], { editable: !list?.readOnly });
      entry.stationList.setActive(activeStationId);
    },
    setActiveStation(stationId) {
      activeStationId = stationId ?? null;
      for (const { stationList } of pages.values()) stationList.setActive(activeStationId);
    },
    onCurrentChange(cb) { currentChangeCb = cb; },
    onClick(cb) { clickCb = cb; },
    onRemove(cb) { removeCb = cb; },
    onReorder(cb) { reorderCb = cb; },
  };
}
