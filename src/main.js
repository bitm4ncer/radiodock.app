import './styles/index.css';
import { player } from './player/audio.js';
import { attachRecovery } from './player/recovery.js';
import { mountPlayerCard } from './ui/player-card.js';
import { mountStationList } from './ui/station-list.js';
import { mountListDropdown } from './ui/list-dropdown.js';
import { mountSearch } from './ui/search.js';
import { initModals, openModal, closeModal } from './ui/modals.js';
import { toast } from './ui/toast.js';

const COMMUNITY_LIST_ID = '__community__';

// --- Boot UI modules ---
attachRecovery(player);
initModals();

// Player card uses opacity:0 by default, expects a `.loaded` class once UI is wired.
document.getElementById('playerCard').classList.add('loaded');

const playerCard = mountPlayerCard({ player });
const stationList = mountStationList({ container: 'favoritesList' });
const listDropdown = mountListDropdown();
const search = mountSearch({
  onQuery: ({ query }) => {
    // M4 will wire this to the Radio Browser API.
    if (query) toast(`Search arrives in M4 — typed: "${query}"`);
  },
});

// --- Wire about/info modal via the logo button ---
document.getElementById('dockLogoBtn')?.addEventListener('click', () => openModal('infoModal'));

// --- Wire "New List" placeholder (real flow in M3) ---
listDropdown.onAddList(() => {
  openModal('newListModal');
});
listDropdown.onImport(() => {
  toast('Import lands in M3');
});
document.getElementById('cancelListBtn').addEventListener('click', () => closeModal('newListModal'));
document.getElementById('createListBtn').addEventListener('click', () => {
  closeModal('newListModal');
  toast('Custom lists arrive in M3');
});

// --- Station click → play ---
stationList.onClick((station) => {
  stationList.setActive(station.id);
  player.playStation(station);
});

// --- Volume restore (defaults to 80%) ---
const INITIAL_VOLUME_PCT = 80;
player.setVolume(INITIAL_VOLUME_PCT / 100);
playerCard.setVolumePct(INITIAL_VOLUME_PCT);

// --- Highlight playing station on stationchange ---
player.on('stationchange', (evt) => stationList.setActive(evt.detail.station.id));

// --- Load community radios JSON and seed the lists ---
async function bootstrap() {
  try {
    const res = await fetch('/community-radios.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const community = {
      id: COMMUNITY_LIST_ID,
      name: data.listName ?? 'Community Radios',
      stations: data.stations ?? [],
      readOnly: true,
    };
    // In M3 we'll merge in user-created lists from IndexedDB.
    const lists = [community];
    listDropdown.setLists(lists);
    listDropdown.setCurrent(community.id);
    stationList.setStations(community.stations);
  } catch (err) {
    console.error('Failed to load community radios:', err);
    toast('Could not load community stations');
  }
}

bootstrap();

// Expose for ad-hoc debugging
window.__radiodock = { player, playerCard, stationList, listDropdown, search };
