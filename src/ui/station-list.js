// Renders a list of stations into #favoritesList.
// - Click row → play.
// - Optional remove button (only when editable=true, i.e. not the community list).
// - Long-press (touch) or drag-handle (mouse) reorder via Pointer Events.
//   HTML5 drag-and-drop was replaced because it required imprecise long-holds
//   on iOS Safari, gave no auto-scroll near edges, and had no haptic feedback.

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

function stationRow(station, { activeId, editable }) {
  const initials = getInitials(station.name);
  const isActive = station.id === activeId;
  const favicon = station.favicon ? escapeHtml(station.favicon) : '';
  const removeBtn = editable
    ? `<button type="button" class="btn-icon btn-remove" title="Remove from list" aria-label="Remove station">
         <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>
       </button>`
    : '';
  const dragHandle = editable
    ? `<span class="btn-drag" title="Drag to reorder" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.6" fill="currentColor"/><circle cx="15" cy="6" r="1.6" fill="currentColor"/><circle cx="9" cy="12" r="1.6" fill="currentColor"/><circle cx="15" cy="12" r="1.6" fill="currentColor"/><circle cx="9" cy="18" r="1.6" fill="currentColor"/><circle cx="15" cy="18" r="1.6" fill="currentColor"/></svg></span>`
    : '';
  return `
    <div class="station-item${isActive ? ' playing' : ''}" data-id="${escapeHtml(station.id)}">
      ${favicon
        ? `<img class="station-item-logo" src="${favicon}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'station-item-initials',textContent:${JSON.stringify(initials)}}))" />`
        : `<div class="station-item-initials">${escapeHtml(initials)}</div>`}
      <div class="station-item-info">
        <div class="station-item-name">${escapeHtml(station.name ?? '')}</div>
        <div class="station-item-country">${escapeHtml(station.countrycode ?? '')}</div>
      </div>
      ${editable ? `<div class="station-item-actions">${removeBtn}${dragHandle}</div>` : ''}
    </div>
  `;
}

const LONG_PRESS_MS = 300;
const MOVE_THRESHOLD_PX = 10;
const EDGE_ZONE_PX = 60;
const MAX_SCROLL_PX_PER_FRAME = 12;

export function mountStationList({ container }) {
  const listEl = typeof container === 'string' ? document.getElementById(container) : container;
  // Look up the empty-state placeholder as a child of this list's
  // container, not via a global #emptyState ID. Lets the component be
  // instantiated multiple times (one per page) inside the mobile
  // lists-carousel without two instances fighting over the same node.
  const emptyEl = listEl?.querySelector('.empty-state') ?? null;

  let stations = [];
  let activeId = null;
  let editable = false;
  let clickCb = null;
  let removeCb = null;
  let reorderCb = null;
  let rowsHost = null;

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
      if (!editable) return;
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
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';
    const host = ensureRowsHost();
    host.innerHTML = stations.map((s) => stationRow(s, { activeId, editable })).join('');
  }

  return {
    setStations(next, opts = {}) {
      stations = next ?? [];
      if ('editable' in opts) editable = !!opts.editable;
      render();
    },
    setActive(id) {
      activeId = id ?? null;
      render();
    },
    onClick(cb) { clickCb = cb; },
    onRemove(cb) { removeCb = cb; },
    onReorder(cb) { reorderCb = cb; },
  };
}
