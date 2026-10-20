// Inline station info for list rows (Stations browser + Discover collections).
// Shows the same information as the bottom sheet, but directly under the row
// that was expanded - the player's info button keeps the sheet, this is the
// info that belongs to a list entry.

import { fetchStationInfo } from '../data/wikipedia.js';
import { getStationByUuid, getStationInfo } from '../data/stations-source.js';
import { renderStationInfo } from './station-info-render.js';
import { wireStationInfoActions } from './station-info.js';

const CLOSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

function stationIdOf(station) {
  return String(station?.id ?? station?.stationuuid ?? '').trim();
}

export function createInlineStationInfo(station, { onClose } = {}) {
  const id = stationIdOf(station);
  const panel = document.createElement('div');
  panel.className = 'stations-inline-info';
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', `Station info: ${station?.name ?? 'Station'}`);
  panel.innerHTML = `
    <button type="button" class="stations-inline-info-close" data-inline-close aria-label="Close station info">${CLOSE_ICON}</button>
    <div class="stations-inline-info-body station-info-body"></div>
  `;
  const body = panel.querySelector('.stations-inline-info-body');
  let currentFull = null;

  function paint(opts) {
    // The row (and this panel with it) may have been replaced by a new list
    // while the network request was still in flight.
    if (!panel.isConnected) return;
    body.innerHTML = renderStationInfo(station, opts);
  }

  paint({ wikiLoading: true, fullLoading: true });

  const isCustom = id.startsWith('custom-');
  const fullPromise = isCustom
    ? Promise.resolve(null)
    : getStationInfo(id)
        .then((info) => info ?? getStationByUuid(id).catch(() => null))
        .catch(() => getStationByUuid(id).catch(() => null));
  const wikiPromise = fetchStationInfo(station?.name).catch(() => null);

  fullPromise.then((full) => {
    currentFull = full ?? currentFull;
    paint({ full, wikiLoading: true, fullLoading: false });
  });

  Promise.all([fullPromise, wikiPromise]).then(([full, wiki]) => {
    currentFull = full ?? currentFull;
    paint({ full, wiki, wikiLoading: false, fullLoading: false });
  });

  wireStationInfoActions(body, {
    getStation: () => station,
    getFull: () => currentFull,
  });

  panel.querySelector('[data-inline-close]')?.addEventListener('click', () => onClose?.());

  return panel;
}
