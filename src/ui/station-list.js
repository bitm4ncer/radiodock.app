// Renders a list of stations into #favoritesList.
// - Click row → play.
// - Optional remove button (only when editable=true, i.e. not the community list).
// - Drag-and-drop reorder when editable=true.

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
    <div class="station-item${isActive ? ' playing' : ''}" data-id="${escapeHtml(station.id)}" ${editable ? 'draggable="true"' : ''}>
      ${favicon
        ? `<img class="station-item-logo" src="${favicon}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'station-item-initials',textContent:${JSON.stringify(initials)}}))" />`
        : `<div class="station-item-initials">${escapeHtml(initials)}</div>`}
      <div class="station-item-info">
        <div class="station-item-name">${escapeHtml(station.name ?? '')}</div>
        <div class="station-item-country">${escapeHtml(station.countrycode ?? '')}</div>
      </div>
      ${editable ? `<div class="station-item-actions">${dragHandle}${removeBtn}</div>` : ''}
    </div>
  `;
}

export function mountStationList({ container }) {
  const listEl = typeof container === 'string' ? document.getElementById(container) : container;
  const emptyEl = document.getElementById('emptyState');

  let stations = [];
  let activeId = null;
  let editable = false;
  let clickCb = null;
  let removeCb = null;
  let reorderCb = null;
  let rowsHost = null;

  // Drag state
  let dragSrcId = null;
  let lastDropTarget = null;

  function ensureRowsHost() {
    if (rowsHost) return rowsHost;
    rowsHost = document.createElement('div');
    rowsHost.className = 'station-list-rows';
    listEl.append(rowsHost);

    rowsHost.addEventListener('click', (evt) => {
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

    rowsHost.addEventListener('dragstart', (evt) => {
      const row = evt.target.closest('[data-id]');
      if (!row) return;
      dragSrcId = row.dataset.id;
      row.classList.add('dragging');
      evt.dataTransfer.effectAllowed = 'move';
      try {
        evt.dataTransfer.setData('text/plain', dragSrcId);
      } catch {}
    });

    rowsHost.addEventListener('dragover', (evt) => {
      if (!dragSrcId) return;
      evt.preventDefault();
      const row = evt.target.closest('[data-id]');
      if (!row || row.dataset.id === dragSrcId) return;
      if (lastDropTarget && lastDropTarget !== row) {
        lastDropTarget.classList.remove('drag-over');
      }
      row.classList.add('drag-over');
      lastDropTarget = row;
    });

    rowsHost.addEventListener('dragleave', (evt) => {
      const row = evt.target.closest('[data-id]');
      if (row) row.classList.remove('drag-over');
    });

    rowsHost.addEventListener('drop', (evt) => {
      if (!dragSrcId) return;
      evt.preventDefault();
      const targetRow = evt.target.closest('[data-id]');
      if (!targetRow || targetRow.dataset.id === dragSrcId) {
        cleanupDrag();
        return;
      }
      const orderedIds = Array.from(rowsHost.querySelectorAll('[data-id]')).map((el) => el.dataset.id);
      const fromIdx = orderedIds.indexOf(dragSrcId);
      const toIdx = orderedIds.indexOf(targetRow.dataset.id);
      orderedIds.splice(fromIdx, 1);
      orderedIds.splice(toIdx, 0, dragSrcId);
      cleanupDrag();
      reorderCb?.(orderedIds);
    });

    rowsHost.addEventListener('dragend', cleanupDrag);

    return rowsHost;
  }

  function cleanupDrag() {
    if (lastDropTarget) lastDropTarget.classList.remove('drag-over');
    rowsHost?.querySelectorAll('.dragging').forEach((el) => el.classList.remove('dragging'));
    rowsHost?.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
    dragSrcId = null;
    lastDropTarget = null;
  }

  function render() {
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
