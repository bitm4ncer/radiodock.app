import './styles/index.css';
import { player } from './player/audio.js';
import { attachRecovery } from './player/recovery.js';
import { attachMetadataPoller } from './player/metadata-poller.js';
import { attachMediaSession } from './player/media-session.js';
import { mountInstallInfo } from './ui/install-info.js';
import { mountInstallSection } from './ui/install-section.js';
import { mountOffCanvas } from './ui/off-canvas.js';
import { mountSearchOverlay } from './ui/search-overlay.js';
import { mountPlayerCard } from './ui/player-card.js';
import { mountStationList } from './ui/station-list.js';
import { mountListDropdown } from './ui/list-dropdown.js';
import { mountSearch } from './ui/search.js';
import { initModals, openModal, closeModal } from './ui/modals.js';
import { toast } from './ui/toast.js';
import { promptDialog, confirmDialog, choiceDialog } from './ui/modal-helpers.js';
import * as listsApi from './data/lists.js';
import * as storage from './data/storage.js';
import { downloadList, parseExport, applyImport } from './data/import-export.js';
import { buildShareUrl, tryDecodeShareHash } from './data/share.js';
import { searchStations } from './data/radio-browser.js';
import { mountVisualizer } from './visualizer/bootstrap.js';
import { mountPlayerCardDragMinimize } from './ui/player-card-drag.js';
import { track } from './analytics/umami.js';

const COMMUNITY_LIST_ID = listsApi.COMMUNITY_LIST_ID;

// --- App state ---
const state = {
  community: { id: COMMUNITY_LIST_ID, name: 'Community Radios', stations: [], readOnly: true },
  userLists: [],            // [{id, name, stations, order, ...}]
  currentListId: null,      // active list (community or a user list)
  currentStation: null,
};

// --- Boot UI modules ---
attachRecovery(player);
attachMetadataPoller(player);
attachMediaSession(player);
initModals();
document.getElementById('playerCard').classList.add('loaded');

// Block pinch-zoom on iOS Safari. The viewport meta `user-scalable=no` and
// `maximum-scale=1` are unreliable on iOS 10+ (Safari ignores them for
// accessibility reasons). We additionally swallow the legacy `gesture*`
// events (Safari-specific) and `touchmove` events that involve more than
// one finger. Single-finger touches still pass through, so scrolling
// works normally.
(() => {
  const block = (evt) => evt.preventDefault();
  document.addEventListener('gesturestart', block, { passive: false });
  document.addEventListener('gesturechange', block, { passive: false });
  document.addEventListener('gestureend', block, { passive: false });
  document.addEventListener(
    'touchmove',
    (evt) => {
      if (evt.touches.length > 1) evt.preventDefault();
    },
    { passive: false },
  );
  // Block double-tap-to-zoom too (iOS / Android both ship this).
  let lastTouchEnd = 0;
  document.addEventListener(
    'touchend',
    (evt) => {
      const now = Date.now();
      if (now - lastTouchEnd <= 320) evt.preventDefault();
      lastTouchEnd = now;
    },
    { passive: false },
  );
})();

// Fire-and-forget warm-up ping to the metadata proxy. Render's free tier
// spins down after 15 min of inactivity; the GitHub Actions cron keeps it
// warm most of the time, but if a ping was skipped, this one wakes the
// dyno before the user picks a station. Errors are silently ignored.
fetch('https://radiodock-metadata-proxy-1.onrender.com/health', {
  method: 'GET',
  cache: 'no-store',
  keepalive: true,
}).catch(() => {});

const playerCard = mountPlayerCard({ player });
const stationList = mountStationList({ container: 'favoritesList' });
const listDropdown = mountListDropdown();
// Search tracking is debounced separately from the API-fire debounce: the
// 300ms input-debounce in search.js is tuned for snappy results, but with
// slow typing (>300ms between chars) it fires one API call — and therefore
// one track event — per character. Wait for the user to actually settle
// on a query (1500ms idle) before emitting the analytics event.
let searchTrackTimer = null;
function scheduleSearchTrack(payload) {
  if (searchTrackTimer) clearTimeout(searchTrackTimer);
  searchTrackTimer = setTimeout(() => {
    track('search', payload);
    searchTrackTimer = null;
  }, 1500);
}

const search = mountSearch({
  onSearch: async ({ query, filter }, transport) => {
    const results = await searchStations({ query, filter }, transport);
    scheduleSearchTrack({ filter, resultCount: results?.length ?? 0 });
    return results;
  },
  onPlay: (station) => {
    track('station-play', {
      station: station.name ?? '',
      country: station.countrycode ?? '',
      source: 'search',
    });
    player.playStation(station);
  },
  onAdd: async (station) => {
    // Add to the currently-active editable list. Fall back to Favorites when
    // viewing Community Radios (the heart already targets Favorites).
    const targetList = (findList(state.currentListId)?.readOnly === false
      ? findList(state.currentListId)
      : favoritesList());
    if (!targetList) return;
    try {
      await listsApi.addStationToList(targetList.id, station);
      targetList.stations = [...targetList.stations, station];
      if (state.currentListId === targetList.id) renderActiveList();
      else listDropdown.setLists(allListsForDropdown());
      search.refreshAddedFlags();
      track('station-add', { country: station.countrycode ?? '' });
      toast(`Added to "${targetList.name}"`);
    } catch (err) {
      toast(err.message);
    }
  },
  isAlreadyInActiveList: (stationId) => {
    const list = (findList(state.currentListId)?.readOnly === false
      ? findList(state.currentListId)
      : favoritesList());
    return !!list?.stations.some((s) => s.id === stationId);
  },
  canAddToActiveList: () => true,
});

// About modal. Wrapper that resets the tech-details toggle to collapsed
// each time the modal opens — readers always land on the plain-language
// overview first, even if they expanded the tech section last visit.
function openAboutModal() {
  const body = document.getElementById('aboutModalBody');
  body?.classList.remove('show-tech');
  document.getElementById('aboutMoreBtn')?.setAttribute('aria-expanded', 'false');
  openModal('infoModal');
}
document.getElementById('dockLogoBtn')?.addEventListener('click', openAboutModal);
document.getElementById('aboutMoreBtn')?.addEventListener('click', () => {
  const body = document.getElementById('aboutModalBody');
  const btn = document.getElementById('aboutMoreBtn');
  const expanded = body?.classList.toggle('show-tech');
  btn?.setAttribute('aria-expanded', String(!!expanded));
});
// Legal Notice now lives on its own /legal.html page (noindex'd) — see footer.

// Add-to-Home-Screen onboarding. The modal is opened from the Install
// Section — no more auto-show or floating button.
const installInfo = mountInstallInfo();
mountInstallSection({
  // Mount on <body>, not inside #app — the install section is a floating
  // overlay (position: fixed bottom-right on desktop, hidden on mobile);
  // it shouldn't inherit container minimize / animate rules.
  container: document.body,
  installInfo,
});

// "Install on Devices" pill in the desktop footer re-summons the install
// badge with a slide-in transition. Clears the dismissed-pref so the badge
// stays the next time the user reloads.
document.getElementById('footerReinstallBtn')?.addEventListener('click', () => {
  mountInstallSection({
    // Must match the auto-mount call above — body, not #app — so the badge
    // anchors to the viewport and isn't collapsed by the container's
    // minimize selector.
    container: document.body,
    installInfo,
    animateIn: true,
  });
});

// Mobile off-canvas drawer
mountOffCanvas({
  triggerBtn: document.getElementById('menuBtn'),
  panel: document.getElementById('mobileMenu'),
  onInstallClick: () => {
    // Hand off to the install-section's first applicable platform — for
    // a phone user this resolves to the mobile branch of the modal.
    const ua = navigator.userAgent;
    const branch = /android/i.test(ua) ? 'android' : 'ios-safari';
    track('install-click', { platform: branch, source: 'drawer' });
    installInfo.open(branch);
  },
  onAboutClick: openAboutModal,
});

// Delegated tracking for the install-section's platform buttons. The
// section is mounted twice (auto + footer re-summon) and re-rendered on
// detail/overview swaps, so a delegated listener on body is simpler than
// wiring an onPlatformClick callback through mountInstallSection.
document.body.addEventListener('click', (evt) => {
  const btn = evt.target.closest('.install-section__btn[data-target]');
  if (!btn) return;
  track('install-click', { platform: btn.dataset.target, source: 'badge' });
});

// PWA install completion. Fires once per device when the user accepts
// the install prompt (Android Chrome / Desktop Chromium). iOS Safari
// does not fire this event — the Add-to-Home-Screen flow is entirely
// manual there, so iOS installs go uncounted at this layer.
window.addEventListener('appinstalled', () => track('pwa-installed'));

// Buy-Me-a-Coffee outbound link. Two link instances live in the DOM
// (mobile drawer + desktop footer); delegating from body covers both
// without per-element wiring. The link's container class disambiguates
// which surface the click came from.
document.body.addEventListener('click', (evt) => {
  const link = evt.target.closest('a[href*="buymeacoffee.com"]');
  if (!link) return;
  const source = link.closest('.off-canvas') ? 'drawer' : 'footer';
  track('bmc-click', { source });
});

// Mobile fullscreen search overlay
mountSearchOverlay({
  triggerBtn: document.getElementById('searchTriggerBtn'),
  overlay: document.getElementById('searchOverlay'),
});

// Visualizer (desktop only; mounts trigger button into the player card).
mountVisualizer({ player })
  .then((viz) => {
    if (viz) window.__radiodock = Object.assign(window.__radiodock ?? {}, { visualizer: viz });
  })
  .catch((err) => console.warn('Visualizer mount failed:', err));

// Drag + minimize for the player card (desktop only).
mountPlayerCardDragMinimize().catch((err) => console.warn('Player card drag mount failed:', err));

// --- Helpers ---
function allListsForDropdown() {
  return [state.community, ...state.userLists];
}

function findList(id) {
  if (id === COMMUNITY_LIST_ID) return state.community;
  return state.userLists.find((l) => l.id === id);
}

function renderActiveList() {
  const list = findList(state.currentListId) ?? state.community;
  state.currentListId = list.id;
  listDropdown.setLists(allListsForDropdown());
  listDropdown.setCurrent(list.id);
  stationList.setStations(list.stations, { editable: !list.readOnly });
  stationList.setActive(state.currentStation?.id ?? null);
  updateFavoriteHeart();
}

function favoritesList() {
  // Convention: the first user list is "Favorites" (created lazily by getUserLists).
  return state.userLists[0];
}

function isStationFavorited(station) {
  if (!station) return false;
  const fav = favoritesList();
  return !!fav?.stations.some((s) => s.id === station.id);
}

function updateFavoriteHeart() {
  playerCard.setFavoriteState(isStationFavorited(state.currentStation));
}

// --- Player events ---
player.on('stationchange', async (evt) => {
  state.currentStation = evt.detail.station;
  stationList.setActive(state.currentStation.id);
  updateFavoriteHeart();
  await storage.setPref('currentStationId', state.currentStation.id);
});

player.on('error', (evt) => {
  const station = player.getCurrentStation();
  track('stream-error', {
    station: station?.name ?? '',
    errorName: evt.detail?.name ?? '',
  });
});

// --- Volume restore ---
async function restoreVolume() {
  const v = await storage.getPref('volume', 0.8);
  player.setVolume(v);
  playerCard.setVolumePct(Math.round(v * 100));
}
player.on('volumechange', async (evt) => {
  await storage.setPref('volume', evt.detail.volume);
});

// --- Station list interactions ---
stationList.onClick((station) => {
  track('station-play', {
    station: station.name ?? '',
    country: station.countrycode ?? '',
    source: state.currentListId === COMMUNITY_LIST_ID ? 'community' : 'user-list',
  });
  player.playStation(station);
});

stationList.onRemove(async (stationId) => {
  const list = findList(state.currentListId);
  if (!list || list.readOnly) return;
  try {
    await listsApi.removeStationFromList(list.id, stationId);
    list.stations = list.stations.filter((s) => s.id !== stationId);
    renderActiveList();
  } catch (err) {
    toast(err.message);
  }
});

stationList.onReorder(async (orderedIds) => {
  const list = findList(state.currentListId);
  if (!list || list.readOnly) return;
  try {
    const updated = await listsApi.reorderStationsInList(list.id, orderedIds);
    list.stations = updated.stations;
    renderActiveList();
  } catch (err) {
    toast(err.message);
  }
});

// --- Favorites heart on player card ---
playerCard.onFavoriteClick(async (station) => {
  if (!station) return;
  const fav = favoritesList();
  if (!fav) return;
  const has = fav.stations.some((s) => s.id === station.id);
  try {
    if (has) {
      await listsApi.removeStationFromList(fav.id, station.id);
      fav.stations = fav.stations.filter((s) => s.id !== station.id);
      toast('Removed from Favorites');
    } else {
      await listsApi.addStationToList(fav.id, station);
      fav.stations = [...fav.stations, station];
      toast('Added to Favorites');
    }
    updateFavoriteHeart();
    if (state.currentListId === fav.id) renderActiveList();
    else listDropdown.setLists(allListsForDropdown());
  } catch (err) {
    toast(err.message);
  }
});

// --- List dropdown ---
listDropdown.onSelect(async (list) => {
  state.currentListId = list.id;
  renderActiveList();
  await storage.setPref('currentListId', list.id);
});

listDropdown.onAddList(async () => {
  const name = await promptDialog({
    title: 'Create New Station List',
    label: 'List Name:',
    placeholder: 'Enter list name…',
    confirmLabel: 'Create List',
    validate: (v) => {
      if (!v) return 'List name is required.';
      if (v.length > 50) return 'Too long (max 50 characters).';
      return null;
    },
  });
  if (!name) return;
  try {
    const created = await listsApi.createList(name);
    state.userLists.push(created);
    state.currentListId = created.id;
    renderActiveList();
    await storage.setPref('currentListId', created.id);
    track('list-create');
    toast(`Created "${created.name}"`);
  } catch (err) {
    toast(err.message);
  }
});

listDropdown.onRename(async (list) => {
  const next = await promptDialog({
    title: 'Rename List',
    label: 'New name:',
    defaultValue: list.name,
    confirmLabel: 'Rename',
  });
  if (!next || next === list.name) return;
  try {
    const updated = await listsApi.renameList(list.id, next);
    list.name = updated.name;
    renderActiveList();
    toast(`Renamed to "${updated.name}"`);
  } catch (err) {
    toast(err.message);
  }
});

listDropdown.onExport((list) => {
  downloadList(list);
  track('list-export', { stationCount: list.stations?.length ?? 0 });
});

listDropdown.onShare(async (list) => {
  try {
    const url = await buildShareUrl(list);
    openShareModal({ list, url });
    track('list-share', { stationCount: list.stations?.length ?? 0 });
  } catch (err) {
    console.error('Share-link build failed:', err);
    toast('Could not build share link.');
  }
});

function openShareModal({ list, url }) {
  const titleEl = document.getElementById('shareTitle');
  const input = document.getElementById('shareLinkInput');
  const copyBtn = document.getElementById('copyShareLinkBtn');
  titleEl.textContent = `Share "${list.name}"`;
  input.value = url;

  const originalLabel = 'Copy link';
  copyBtn.textContent = originalLabel;

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Fallback for browsers that haven't granted clipboard permission
      // — selecting the input + execCommand still works on iOS Safari
      // because we're in a user gesture.
      input.focus();
      input.select();
      try { document.execCommand('copy'); } catch {}
    }
    copyBtn.textContent = 'Copied!';
    setTimeout(() => { copyBtn.textContent = originalLabel; }, 1500);
  };
  copyBtn.addEventListener('click', onCopy, { once: true });
  openModal('shareModal');
  // Pre-select the URL so a long-press → Copy on mobile picks it up cleanly.
  setTimeout(() => { input.focus(); input.select(); }, 50);
}

listDropdown.onDelete(async (list) => {
  const ok = await confirmDialog({
    title: 'Delete List',
    message: `Delete "${list.name}"? This cannot be undone.`,
    confirmLabel: 'Delete',
  });
  if (!ok) return;
  try {
    await listsApi.deleteList(list.id);
    state.userLists = state.userLists.filter((l) => l.id !== list.id);
    if (state.currentListId === list.id) {
      state.currentListId = favoritesList()?.id ?? COMMUNITY_LIST_ID;
      await storage.setPref('currentListId', state.currentListId);
    }
    renderActiveList();
    track('list-delete');
    toast(`Deleted "${list.name}"`);
  } catch (err) {
    toast(err.message);
  }
});

listDropdown.onImport(async (file) => {
  try {
    const text = await file.text();
    const parsed = parseExport(text);
    const created = await applyImport(parsed);
    state.userLists = await listsApi.getUserLists();
    if (created[0]) state.currentListId = created[0].id;
    renderActiveList();
    track('list-import', { count: created.length });
    toast(created.length === 1 ? `Imported "${created[0].name}"` : `Imported ${created.length} lists`);
  } catch (err) {
    toast(`Import failed: ${err.message}`);
  }
});

// --- Bootstrap ---
async function bootstrap() {
  try {
    const [communityRes, userLists, prefs] = await Promise.all([
      fetch('/community-radios.json').then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))),
      listsApi.getUserLists(),
      storage.getAllPrefs(),
    ]);

    state.community = {
      id: COMMUNITY_LIST_ID,
      name: communityRes.listName ?? 'Community Radios',
      stations: communityRes.stations ?? [],
      readOnly: true,
    };
    state.userLists = userLists;
    state.currentListId = prefs.currentListId ?? COMMUNITY_LIST_ID;
    if (!findList(state.currentListId)) state.currentListId = COMMUNITY_LIST_ID;

    await restoreVolume();
    renderActiveList();

    // Restore current station view (without auto-playing — first play needs user gesture).
    if (prefs.currentStationId) {
      const all = [
        ...state.community.stations,
        ...state.userLists.flatMap((l) => l.stations),
      ];
      const station = all.find((s) => s.id === prefs.currentStationId);
      if (station) {
        state.currentStation = station;
        playerCard.setStation(station);
        stationList.setActive(station.id);
        updateFavoriteHeart();
      }
    }
  } catch (err) {
    console.error('Bootstrap failed:', err);
    toast('Could not load app state');
  }
}

bootstrap().then(() => handleInboundShareHash());

// Also run the handler on hashchange, so pasting a share URL into an
// already-open tab triggers the import flow (otherwise the URL change
// is just a fragment shift and bootstrap wouldn't re-run).
window.addEventListener('hashchange', () => handleInboundShareHash());

// Inbound share-link handler. Runs after bootstrap so state.userLists is
// populated and the collision check has something to compare against.
// The hash never reached a server (browsers strip the fragment from
// outbound requests), so by reading it here we keep the privacy story
// intact: shared list data only ever exists in the recipient's browser.
async function handleInboundShareHash() {
  const hash = window.location.hash;
  let parsed;
  try {
    parsed = await tryDecodeShareHash(hash);
  } catch (err) {
    console.warn('Share-hash decode failed:', err);
    toast('Share link is invalid or corrupted.');
    clearShareHash();
    return;
  }
  if (!parsed) return;

  // Validate against the existing JSON-import parser — same rules apply
  // (multi-list vs single-list, station-shape filter).
  let validated;
  try {
    validated = parseExport(JSON.stringify(parsed));
  } catch (err) {
    toast(`Share link rejected: ${err.message}`);
    clearShareHash();
    return;
  }

  if (validated.kind === 'single') {
    await importSharedSingle(validated.list);
  } else {
    // Multi-list bundle — no collision UI yet, fall back to the existing
    // auto-rename pipeline. Unusual case in practice (share button only
    // ever produces single-list payloads).
    await confirmAndImportMulti(validated);
  }
  clearShareHash();
}

async function importSharedSingle({ name, stations }) {
  const existing = state.userLists.find(
    (l) => !l.readOnly && l.name.toLowerCase() === name.toLowerCase(),
  );

  if (!existing) {
    const ok = await confirmDialog({
      title: 'Import shared list',
      message: `Import "${name}" with ${stations.length} ${stations.length === 1 ? 'station' : 'stations'}?`,
      confirmLabel: 'Import',
      danger: false,
    });
    if (!ok) return;
    const [created] = await applyImport({ kind: 'single', list: { name, stations } });
    if (created) await switchToList(created.id);
    track('list-import-shared', { stationCount: stations.length, resolution: 'new' });
    toast(`Imported "${created?.name ?? name}"`);
    return;
  }

  const choice = await choiceDialog({
    title: 'List name already exists',
    message: `You already have a list called "${existing.name}". Replace its ${existing.stations.length} stations with the shared ${stations.length}, or keep both as separate lists?`,
    primaryLabel: 'Replace',
    secondaryLabel: 'Keep both',
    primaryDanger: true,
  });
  if (choice === null) return;

  try {
    if (choice === 'primary') {
      const updated = await listsApi.replaceListStations(existing.id, stations);
      existing.stations = updated.stations;
      await switchToList(existing.id);
      track('list-import-shared', { stationCount: stations.length, resolution: 'replace' });
      toast(`Updated "${existing.name}"`);
    } else {
      const [created] = await applyImport({ kind: 'single', list: { name, stations } });
      if (created) await switchToList(created.id);
      track('list-import-shared', { stationCount: stations.length, resolution: 'new' });
      toast(`Imported "${created?.name ?? name}"`);
    }
  } catch (err) {
    console.error('Shared-list import failed:', err);
    toast(`Import failed: ${err.message}`);
  }
}

async function confirmAndImportMulti(parsed) {
  const total = parsed.lists.reduce((sum, l) => sum + l.stations.length, 0);
  const ok = await confirmDialog({
    title: 'Import shared lists',
    message: `Import ${parsed.lists.length} lists (${total} stations total)?`,
    confirmLabel: 'Import',
    danger: false,
  });
  if (!ok) return;
  try {
    const created = await applyImport(parsed);
    state.userLists = await listsApi.getUserLists();
    if (created[0]) await switchToList(created[0].id);
    track('list-import-shared', { listCount: created.length, resolution: 'new' });
    toast(`Imported ${created.length} lists`);
  } catch (err) {
    console.error('Shared multi-import failed:', err);
    toast(`Import failed: ${err.message}`);
  }
}

async function switchToList(id) {
  state.userLists = await listsApi.getUserLists();
  state.currentListId = id;
  await storage.setPref('currentListId', id);
  renderActiveList();
}

function clearShareHash() {
  // history.replaceState avoids re-running the importer on reload while
  // keeping the page URL clean (no #s=… cruft in the address bar).
  if (window.location.hash) {
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }
}

// Standalone (PWA) desktop launches: shrink the window once to match the
// Chrome-extension popup dimensions. Skipped on mobile (window manager
// ignores it anyway) and skipped after the user has manually resized
// (we only do it on first launch per session-stored pref).
async function fitWindowToExtensionSize() {
  const inStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
  if (!inStandalone) return;
  // Heuristic: only fire on desktop-class viewports; mobile installs are full-screen.
  if (matchMedia('(pointer: coarse)').matches) return;
  if (await storage.getPref('didFitWindow', false)) return;
  try {
    window.resizeTo(440, 760);
    await storage.setPref('didFitWindow', true);
  } catch {}
}
fitWindowToExtensionSize();

// Register the service worker in production. The dev server already serves
// fresh modules and a SW only gets in the way during development.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('SW registration failed:', err);
    });
  });
}

// Debug handle
window.__radiodock = { player, playerCard, stationList, listDropdown, state, listsApi, storage };
