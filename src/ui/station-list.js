// Renders a list of stations into #favoritesList and dispatches a click
// callback when a row is selected. Drag-drop reorder lands in M3 with
// the storage layer. Uses the existing popup CSS classnames so the visual
// styling carries over verbatim.

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

function stationRow(station, { activeId }) {
  const initials = getInitials(station.name);
  const isActive = station.id === activeId;
  const favicon = station.favicon ? escapeHtml(station.favicon) : '';
  // .station-item-logo is applied directly to the <img>; .station-item-initials
  // is a sibling <div>. Image swap-to-initials happens via onerror.
  return `
    <div class="station-item${isActive ? ' playing' : ''}" data-id="${escapeHtml(station.id)}">
      ${favicon
        ? `<img class="station-item-logo" src="${favicon}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'station-item-initials',textContent:${JSON.stringify(initials)}}))" />`
        : `<div class="station-item-initials">${escapeHtml(initials)}</div>`}
      <div class="station-item-info">
        <div class="station-item-name">${escapeHtml(station.name ?? '')}</div>
        <div class="station-item-country">${escapeHtml(station.countrycode ?? '')}</div>
      </div>
    </div>
  `;
}

export function mountStationList({ container }) {
  const listEl = typeof container === 'string' ? document.getElementById(container) : container;
  const emptyEl = document.getElementById('emptyState');

  let stations = [];
  let activeId = null;
  let clickCallback = null;
  let rowsHost = null;

  function render() {
    if (!stations.length) {
      if (emptyEl) emptyEl.style.display = '';
      if (rowsHost) rowsHost.remove();
      rowsHost = null;
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    if (!rowsHost) {
      rowsHost = document.createElement('div');
      rowsHost.className = 'station-list-rows';
      listEl.append(rowsHost);
      rowsHost.addEventListener('click', (evt) => {
        const row = evt.target.closest('[data-id]');
        if (!row) return;
        const station = stations.find((s) => s.id === row.dataset.id);
        if (station) clickCallback?.(station);
      });
    }

    rowsHost.innerHTML = stations.map((s) => stationRow(s, { activeId })).join('');
  }

  return {
    setStations(next) {
      stations = next ?? [];
      render();
    },
    setActive(id) {
      activeId = id ?? null;
      render();
    },
    onClick(cb) {
      clickCallback = cb;
    },
  };
}
