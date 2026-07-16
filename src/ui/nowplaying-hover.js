// Desktop hover preview of a station's live now-playing, for station rows
// (search results and lists). Hovering a row for ~400 ms queries the metadata
// proxy (via the existing primary+fallback client) and shows the parsed
// now-playing inline under the station name. Hover intent means scrolling past
// rows doesn't fire requests; a short client cache keeps repeated hovers free.
//
// Desktop only — the app is mobile-first and hover doesn't exist on touch, where
// a tap already plays the station. Guarded by a hover/pointer media query.

import { fetchNowPlaying } from '../data/metadata.js';

const HOVER_INTENT_MS = 400;
const CACHE_TTL_MS = 15000; // matches the proxy's ~15 s cache

const cache = new Map(); // key -> { at, value }

function canHover() {
  return typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches;
}

async function resolveNowPlaying(station) {
  const key = station.id || station.url;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const value = await fetchNowPlaying({
    streamUrl: station.url,
    stationId: station.id,
    homepage: station.homepage,
    country: station.countrycode,
  }).catch(() => null);
  cache.set(key, { at: Date.now(), value });
  return value;
}

const ROW_SELECTOR = '.search-item, .station-item';

/**
 * @param {HTMLElement} rootEl the list/results container (event-delegated)
 * @param {(rowEl: HTMLElement) => object|null} getStation resolves a row to its station
 */
export function mountNowPlayingHover(rootEl, getStation) {
  if (!rootEl || rootEl.dataset.nowplayingMounted === '1') return;
  rootEl.dataset.nowplayingMounted = '1';
  if (!canHover()) return; // touch: no hover affordance

  let timer = null;
  let activeRow = null;

  const clearTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };

  const removeSlot = (row) => {
    row?.querySelector('.station-item-nowplaying')?.remove();
  };

  rootEl.addEventListener('mouseover', (evt) => {
    const row = evt.target.closest(ROW_SELECTOR);
    if (!row || !rootEl.contains(row) || row === activeRow) return;
    if (activeRow) { clearTimer(); removeSlot(activeRow); }
    activeRow = row;
    clearTimer();
    timer = setTimeout(async () => {
      const station = getStation(row);
      if (!station?.url) return;
      const info = row.querySelector('.station-item-info');
      if (!info) return;

      let slot = info.querySelector('.station-item-nowplaying');
      if (!slot) {
        slot = document.createElement('div');
        slot.className = 'station-item-nowplaying';
        info.appendChild(slot);
      }
      slot.textContent = '…';

      const np = await resolveNowPlaying(station);
      // The row may have been left or re-rendered during the await.
      if (activeRow !== row || !info.isConnected) return;
      if (np?.nowPlaying) {
        slot.textContent = np.nowPlaying;
        slot.classList.add('has-np');
      } else {
        slot.remove();
      }
    }, HOVER_INTENT_MS);
  });

  rootEl.addEventListener('mouseout', (evt) => {
    const row = evt.target.closest(ROW_SELECTOR);
    if (!row) return;
    // Ignore moves within the same row (child → child).
    if (row.contains(evt.relatedTarget)) return;
    clearTimer();
    removeSlot(row);
    if (row === activeRow) activeRow = null;
  });
}
